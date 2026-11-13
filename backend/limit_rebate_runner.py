#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
库存有界 · 限价返佣演习（TMGM 模拟盘 / VPS MT5）。

- JSONL：意图、双时刻报价、理论价、挂单、TTL 撤单、成交滑点
- 报价漂移：超过阈值时可 reprice_once（防「回头一瞬间挂不上」）

用法：
  py -3 limit_rebate_runner.py --config config\\limit_rebate_tmgm_demo.json
  py -3 limit_rebate_runner.py --config config\\limit_rebate_tmgm_demo.json --live
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd

BACKEND = Path(__file__).resolve().parent
XAU_ROOT = BACKEND.parents[1]
sys.path.insert(0, str(BACKEND))
sys.path.insert(0, str(XAU_ROOT))

from beijing_sessions import beijing_trading_day_label  # noqa: E402
from mt5_bridge import ensure_mt5, fetch_bars, resolve_symbol  # noqa: E402
from mt5_trading import MAGIC, account_snapshot, cancel_order, limit_order, list_orders, list_positions  # noqa: E402
from rebate_drill_journal import (  # noqa: E402
    append_event,
    journal_dir,
    lookup_deal_for_order,
    new_intent_id,
    parity_theory_fields,
    price_touched,
    slip_vs_intent,
    sync_entry_deals,
    sync_exit_deals,
    theory_bundle,
)

RUNNER_STATE = BACKEND / "limit_rebate_runner_state.json"


def load_cfg(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def save_state(state: dict) -> None:
    RUNNER_STATE.write_text(json.dumps(state, indent=2, ensure_ascii=False), encoding="utf-8")


def net_lots_app(symbol: str) -> float:
    pos = list_positions(symbol=symbol, magic=MAGIC)
    net = 0.0
    for p in pos:
        vol = float(p.get("lots", 0))
        side = p.get("side")
        if side == "buy":
            net += vol
        elif side == "sell":
            net -= vol
    return net


def _bars(sym: str, tf: str, count: int) -> list:
    bars, _ = fetch_bars(sym, tf, count=count)
    return bars


def last_closed_5m_key(sym: str) -> str | None:
    bars = _bars(sym, "5m", 3)
    if len(bars) < 2:
        return None
    return str(bars[-2]["time"])


def signal_side_v003(sym: str) -> tuple[int, dict]:
    from live_v003_signal import MMParams, add_bb_fib, prepare_signals, resample_ohlcv, signal_side_at  # noqa: E402
    from score_long_prob_5m30m1h import score_long_and_short_v003, score_state_bars  # noqa: E402

    m1 = _bars(sym, "1m", 8000)
    if len(m1) < 500:
        return 0, {"error": "insufficient_1m_bars"}
    raw = pd.DataFrame(m1)
    raw = raw.rename(columns={"time": "open_time"})
    raw["open_time"] = pd.to_datetime(raw["open_time"], unit="s", utc=True)
    m5 = add_bb_fib(resample_ohlcv(raw, "5min"), 20, 2.0)
    m30 = add_bb_fib(resample_ohlcv(raw, "30min"), 20, 2.0)
    m60 = add_bb_fib(resample_ohlcv(raw, "60min"), 20, 2.0)
    s30l = score_state_bars(m30, short=False)
    s30s = score_state_bars(m30, short=True)
    long_df, short_df = score_long_and_short_v003(m5, m30, m60, s30l, s30s)
    p = MMParams(smooth_min=3, long_thr=10.0, short_thr=10.0)
    sig = prepare_signals(long_df, short_df, p)
    i = len(sig) - 2
    if i < 1:
        return 0, {"error": "no_signal_bar"}
    side = signal_side_at(
        i,
        sig["p_long_smooth"].to_numpy(),
        sig["p_short_smooth"].to_numpy(),
        sig["ma_zone"].to_numpy() if "ma_zone" in sig.columns else None,
        p,
    )
    signal_close = float(sig["close"].iloc[i]) if "close" in sig.columns else float(m5["close"].iloc[-2])
    bar_t = str(sig["open_time"].iloc[i]) if "open_time" in sig.columns else None
    return side, {
        "sig_i": i,
        "p_long": float(sig["p_long_smooth"].iloc[i]),
        "p_short": float(sig["p_short_smooth"].iloc[i]),
        "signal_close": signal_close,
        "signal_bar_time": bar_t,
    }


def snapshot_tick(mt5, sym: str) -> dict | None:
    mt5.symbol_select(sym, True)
    t = mt5.symbol_info_tick(sym)
    i = mt5.symbol_info(sym)
    if t is None or i is None:
        return None
    bid, ask = float(t.bid), float(t.ask)
    return {
        "bid": bid,
        "ask": ask,
        "mid": round((bid + ask) / 2.0, 5),
        "spread_usd": round(ask - bid, 5),
        "spread_points": int(i.spread),
        "tick_time_unix": int(t.time),
    }


def passive_px(side_sign: int, q: dict) -> float:
    return q["bid"] if side_sign > 0 else q["ask"]


def drift_ok(cfg: dict, side_sign: int, q_signal: dict, q_submit: dict) -> tuple[bool, float, str]:
    qr = cfg.get("quote_refresh") or {}
    max_d = float(qr.get("max_quote_drift_usd", 0.8))
    key = "bid" if side_sign > 0 else "ask"
    drift = float(q_submit[key]) - float(q_signal[key])
    # 多单：bid 下修 → 原挂单价可能高于新 bid，更难成交
    if side_sign > 0 and drift < -max_d:
        return False, drift, "bid_dropped"
    if side_sign < 0 and drift > max_d:
        return False, drift, "ask_rose"
    return True, drift, "ok"


def manage_pending(cfg: dict, state: dict, *, dry: bool, login: int, sym: str, mt5) -> None:
    ttl = float(cfg.get("limit_ttl_seconds", 30))
    magic = int((cfg.get("runner") or {}).get("magic", MAGIC))
    pending: list[dict] = list(state.get("pending_intents") or [])
    if not pending:
        return
    open_orders = {int(o["ticket"]): o for o in list_orders(sym, magic)}
    now = time.time()
    kept: list[dict] = []
    for p in pending:
        ticket = int(p.get("order_ticket") or 0)
        placed = float(p.get("placed_mono") or now)
        intent_id = str(p.get("intent_id") or "")
        age = now - placed
        if ticket <= 0:
            kept.append(p)
            continue
        if ticket not in open_orders:
            deal = None if dry else lookup_deal_for_order(ticket, magic=magic, symbol=sym)
            q_end = snapshot_tick(mt5, sym)
            side = str(p.get("side") or "")
            limit_px = float(p.get("limit_px") or 0)
            theory = p.get("theory_submit") or p.get("theory_signal") or {}
            outcome = "unknown"
            fill_px = None
            if deal:
                outcome = "filled"
                fill_px = float(deal["fill_px"])
                pid = int(deal["position_id"])
                state.setdefault("intent_by_position", {})[pid] = intent_id
                state.setdefault("order_to_intent", {})[ticket] = intent_id
                slip = slip_vs_intent(side=side or deal["side"], intent_px=limit_px, fill_px=fill_px)
                append_event(
                    cfg,
                    {
                        "kind": "order_outcome",
                        "intent_id": intent_id,
                        "order_ticket": ticket,
                        "outcome": outcome,
                        "age_sec": round(age, 2),
                        "fill_px": fill_px,
                        "limit_px": limit_px,
                        "side": side or deal.get("side"),
                        "quote_at_outcome": q_end,
                        "price_touched_at_outcome": price_touched(side or deal["side"], limit_px, q_end["bid"], q_end["ask"])
                        if q_end
                        else None,
                        "theory_match": parity_theory_fields(theory, fill_px),
                        **slip,
                        **{k: deal[k] for k in ("deal_ticket", "position_id", "deal_time_unix") if k in deal},
                    },
                )
                state.setdefault("filled_intents", []).append({**p, "intent_id": intent_id})
            else:
                outcome = "gone_no_deal"
                append_event(
                    cfg,
                    {
                        "kind": "order_outcome",
                        "intent_id": intent_id,
                        "order_ticket": ticket,
                        "outcome": outcome,
                        "age_sec": round(age, 2),
                        "limit_px": limit_px,
                        "quote_at_outcome": q_end,
                    },
                )
            append_event(
                cfg,
                {
                    "kind": "order_gone",
                    "intent_id": intent_id,
                    "order_ticket": ticket,
                    "age_sec": round(age, 2),
                    "outcome": outcome,
                },
            )
            continue
        if age >= ttl:
            q = snapshot_tick(mt5, sym)
            side = str(p.get("side") or "")
            limit_px = float(p.get("limit_px") or 0)
            touched = price_touched(side, limit_px, q["bid"], q["ask"]) if q else None
            append_event(
                cfg,
                {
                    "kind": "ttl_expired",
                    "intent_id": intent_id,
                    "order_ticket": ticket,
                    "age_sec": round(age, 2),
                    "quote_at_cancel": q,
                    "limit_px": limit_px,
                    "price_touched_at_cancel": touched,
                    "outcome": "cancelled_ttl",
                },
            )
            append_event(
                cfg,
                {
                    "kind": "order_outcome",
                    "intent_id": intent_id,
                    "order_ticket": ticket,
                    "outcome": "cancelled_ttl",
                    "age_sec": round(age, 2),
                    "limit_px": limit_px,
                    "quote_at_outcome": q,
                    "price_touched_at_outcome": touched,
                },
            )
            if not dry:
                cancel_order(ticket)
            continue
        kept.append(p)
    state["pending_intents"] = kept


def try_reprice_once(
    cfg: dict,
    *,
    dry: bool,
    intent_id: str,
    side_sign: int,
    oside: str,
    lot: float,
    sl_u: float,
    tp_u: float,
    sym: str,
    q_submit: dict,
    old_px: float,
    drift: float,
    reason: str,
) -> dict | None:
    qr = cfg.get("quote_refresh") or {}
    if qr.get("on_drift") != "reprice_once":
        append_event(
            cfg,
            {"kind": "drift_skip", "intent_id": intent_id, "drift_usd": drift, "reason": reason, "old_px": old_px},
        )
        return None
    new_px = passive_px(side_sign, q_submit)
    if side_sign > 0:
        sl, tp = new_px - sl_u, new_px + tp_u
    else:
        sl, tp = new_px + sl_u, new_px - tp_u
    append_event(
        cfg,
        {
            "kind": "reprice",
            "intent_id": intent_id,
            "drift_usd": drift,
            "reason": reason,
            "old_px": old_px,
            "new_px": new_px,
            "sl": sl,
            "tp": tp,
            "quote": q_submit,
        },
    )
    if dry:
        return {"ok": True, "dry_run": True, "price": new_px}
    return limit_order(side=oside, volume=lot, price=new_px, sl=sl, tp=tp, symbol=sym, comment="rebate_drill")


def poll_deals(cfg: dict, state: dict, login: int, sym: str) -> None:
    seen = {int(x) for x in (state.get("seen_deal_tickets") or [])}
    pos_map = {int(k): v for k, v in (state.get("intent_by_position") or {}).items()}
    o2i = {int(k): str(v) for k, v in (state.get("order_to_intent") or {}).items()}
    new_seen, rows = sync_entry_deals(
        cfg,
        login=login,
        symbol=sym,
        seen_tickets=seen,
        intent_by_position=pos_map,
        order_to_intent=o2i,
    )
    state["intent_by_position"] = pos_map
    state["order_to_intent"] = o2i
    state["seen_deal_tickets"] = sorted(new_seen)[-5000:]
    intents = {p["intent_id"]: p for p in (state.get("pending_intents") or [])}
    intents.update({p.get("intent_id"): p for p in state.get("filled_intents") or [] if p.get("intent_id")})
    for d in rows:
        iid = str(d.get("intent_id") or "")
        meta = intents.get(iid) or {}
        limit_px = float(meta.get("limit_px") or d["fill_px"])
        slip = slip_vs_intent(side=str(d["side"]), intent_px=limit_px, fill_px=float(d["fill_px"]))
        theory = meta.get("theory_submit") or meta.get("theory_signal") or {}
        mid = float(theory.get("mid") or d["fill_px"])
        append_event(
            cfg,
            {
                "kind": "fill_slip",
                "intent_id": iid,
                "deal_ticket": d["deal_ticket"],
                **slip,
                "fill_vs_mid_usd": round(float(d["fill_px"]) - mid, 5),
                "theory_mid": mid,
                "signal_close": theory.get("signal_close"),
                "theory_match": parity_theory_fields(theory, float(d["fill_px"])),
            },
        )
    exit_seen = {int(x) for x in (state.get("seen_exit_deal_tickets") or [])}
    new_exit, _ = sync_exit_deals(
        cfg, login=login, symbol=sym, seen_tickets=exit_seen, intent_by_position=pos_map
    )
    state["seen_exit_deal_tickets"] = sorted(new_exit)[-5000:]


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--config", type=Path, default=BACKEND / "config" / "limit_rebate_tmgm_demo.json")
    ap.add_argument("--live", action="store_true", help="真实挂单（仍须 demo 账户）")
    ap.add_argument("--once", action="store_true", help="只跑一轮")
    args = ap.parse_args()
    cfg = load_cfg(args.config)
    dry = not args.live
    poll = float(cfg.get("runner", {}).get("poll_seconds", 15))
    lot = float(cfg["lot_per_trade"])
    max_net = float(cfg["max_net_lots"])
    tp_u = float(cfg["tp_usd_per_oz"])
    sl_u = float(cfg["sl_usd_per_oz"])

    ensure_mt5()
    import MetaTrader5 as mt5

    journal_dir(cfg)
    sym = resolve_symbol()
    acc = account_snapshot()
    login = int(acc["login"])
    if cfg.get("runner", {}).get("require_demo_account") and acc.get("account_kind") != "demo":
        print(json.dumps({"error": "not_demo_account", "account": acc}, ensure_ascii=False))
        sys.exit(2)

    state: dict = {
        "last_5m_key": None,
        "entries_today": {},
        "pending_intents": [],
        "seen_deal_tickets": [],
        "intent_by_position": {},
        "order_to_intent": {},
        "seen_exit_deal_tickets": [],
        "filled_intents": [],
    }
    if RUNNER_STATE.is_file():
        try:
            state = {**state, **json.loads(RUNNER_STATE.read_text(encoding="utf-8"))}
        except json.JSONDecodeError:
            pass

    append_event(
        cfg,
        {"kind": "runner_start", "dry_run": dry, "symbol": sym, "login": login, "account": acc, "config_mode": cfg.get("mode")},
    )
    print(json.dumps({"start": True, "dry_run": dry, "symbol": sym, "journal": str(journal_dir(cfg))}, ensure_ascii=False))

    while True:
        manage_pending(cfg, state, dry=dry, login=login, sym=sym, mt5=mt5)
        poll_deals(cfg, state, login, sym)

        key = last_closed_5m_key(sym)
        if key and key != state.get("last_5m_key"):
            state["last_5m_key"] = key
            side, meta = signal_side_v003(sym)
            q_sig = snapshot_tick(mt5, sym)
            if q_sig is None:
                time.sleep(poll)
                continue
            net = net_lots_app(sym)
            bjt = beijing_trading_day_label(pd.Series([pd.Timestamp(datetime.now(timezone.utc))])).iloc[0]
            day_n = int(state.get("entries_today", {}).get(bjt, 0))
            max_pd = int(cfg.get("max_new_entries_per_bjt_day", 50))
            intent_id = new_intent_id()
            oside = "buy" if side > 0 else "sell" if side < 0 else ""
            px0 = passive_px(side, q_sig) if side != 0 else None
            theory_sig = (
                theory_bundle(
                    signal_bar_time=meta.get("signal_bar_time"),
                    signal_close=meta.get("signal_close"),
                    bid=q_sig["bid"],
                    ask=q_sig["ask"],
                    passive_px=px0 or 0.0,
                    side=oside,
                )
                if side != 0
                else None
            )
            append_event(
                cfg,
                {
                    "kind": "signal",
                    "intent_id": intent_id,
                    "5m_key": key,
                    "side_sign": side,
                    "meta": meta,
                    "net_lots": net,
                    "bjt": bjt,
                    "quote_signal": q_sig,
                    "theory_signal": theory_sig,
                },
            )

            if side == 0:
                save_state(state)
                print(json.dumps({"5m_key": key, "skip": "no_signal"}, ensure_ascii=False))
            elif day_n >= max_pd:
                append_event(cfg, {"kind": "skip", "intent_id": intent_id, "reason": "daily_cap"})
                save_state(state)
            elif side > 0 and net + lot > max_net + 1e-9:
                append_event(cfg, {"kind": "skip", "intent_id": intent_id, "reason": "net_cap_long"})
                save_state(state)
            elif side < 0 and net - lot < -max_net - 1e-9:
                append_event(cfg, {"kind": "skip", "intent_id": intent_id, "reason": "net_cap_short"})
                save_state(state)
            else:
                q_sub = snapshot_tick(mt5, sym) or q_sig
                ok, drift, drift_reason = drift_ok(cfg, side, q_sig, q_sub)
                px = passive_px(side, q_sub)
                if side > 0:
                    sl, tp = px - sl_u, px + tp_u
                else:
                    sl, tp = px + sl_u, px - tp_u
                theory_sub = theory_bundle(
                    signal_bar_time=meta.get("signal_bar_time"),
                    signal_close=meta.get("signal_close"),
                    bid=q_sub["bid"],
                    ask=q_sub["ask"],
                    passive_px=px,
                    side=oside,
                )
                append_event(
                    cfg,
                    {
                        "kind": "intent",
                        "intent_id": intent_id,
                        "dry_run": dry,
                        "limit_px": px,
                        "sl": sl,
                        "tp": tp,
                        "lots": lot,
                        "quote_signal": q_sig,
                        "quote_submit": q_sub,
                        "quote_drift_usd": round(drift, 5),
                        "quote_drift_reason": drift_reason,
                        "theory_signal": theory_sig,
                        "theory_submit": theory_sub,
                    },
                )
                order_res = None
                if not ok:
                    order_res = try_reprice_once(
                        cfg,
                        dry=dry,
                        intent_id=intent_id,
                        side_sign=side,
                        oside=oside,
                        lot=lot,
                        sl_u=sl_u,
                        tp_u=tp_u,
                        sym=sym,
                        q_submit=q_sub,
                        old_px=passive_px(side, q_sig),
                        drift=drift,
                        reason=drift_reason,
                    )
                    if order_res is None:
                        save_state(state)
                        print(json.dumps({"intent_id": intent_id, "skip": "drift"}, ensure_ascii=False))
                        time.sleep(poll)
                        continue
                    if order_res.get("dry_run"):
                        save_state(state)
                        print(json.dumps({"intent_id": intent_id, "dry_reprice": True}, ensure_ascii=False))
                        time.sleep(poll)
                        continue
                    px = float(order_res.get("price") or px)
                elif not dry:
                    order_res = limit_order(
                        side=oside,
                        volume=lot,
                        price=px,
                        sl=sl,
                        tp=tp,
                        symbol=sym,
                        comment="rebate_drill",
                    )
                else:
                    order_res = {"ok": True, "dry_run": True, "price": px}

                if order_res:
                    append_event(cfg, {"kind": "order_submit", "intent_id": intent_id, "result": order_res, "limit_px": px})
                    if order_res.get("ok") and not order_res.get("dry_run"):
                        ticket = int(order_res.get("order") or 0)
                        state.setdefault("order_to_intent", {})[ticket] = intent_id
                        state.setdefault("pending_intents", []).append(
                            {
                                "intent_id": intent_id,
                                "order_ticket": ticket,
                                "placed_mono": time.monotonic(),
                                "limit_px": px,
                                "side": oside,
                                "theory_signal": theory_sig,
                                "theory_submit": theory_sub,
                                "repriced": not ok,
                            }
                        )
                        state.setdefault("entries_today", {})[bjt] = day_n + 1
                save_state(state)
                print(json.dumps({"intent_id": intent_id, "limit_px": px, "order": order_res}, ensure_ascii=False))

        save_state(state)
        if args.once:
            break
        time.sleep(poll)


if __name__ == "__main__":
    main()
