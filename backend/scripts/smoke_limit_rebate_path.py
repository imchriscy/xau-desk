#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
冒烟：MT5 通路 → v003 信号 → 被动限价挂单 → TTL 内成交/撤单观测。

输出 JSON：挂单是否成功、TTL 内是否成交、监视窗内 BBO 是否触价（理论可成交）、
成交价相对 intent / signal_close 的滑点；并与回测 fill_prob=0.99 对照说明。
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))
XAU_ROOT = BACKEND.parents[1]
sys.path.insert(0, str(XAU_ROOT))

def load_cfg(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def _bars(sym: str, tf: str, count: int) -> list:
    from mt5_bridge import fetch_bars

    bars, _ = fetch_bars(sym, tf, count=count)
    return bars


def passive_px(side_sign: int, q: dict) -> float:
    return q["bid"] if side_sign > 0 else q["ask"]


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
from mt5_bridge import ensure_mt5, resolve_symbol  # noqa: E402
from mt5_trading import MAGIC, account_snapshot, cancel_order, limit_order, list_orders  # noqa: E402
from rebate_drill_journal import append_event, theory_bundle  # noqa: E402


def _touch_theoretical(side: str, limit_px: float, bid: float, ask: float) -> bool:
    """被动限价在报价上是否已处于可成交侧（瞬时 BBO）。"""
    if side == "buy":
        return ask <= limit_px + 1e-9
    return bid >= limit_px - 1e-9


def _bar_touch(side: str, limit_px: float, bid: float, ask: float) -> bool:
    """监视周期内：多单看 ask 是否打到限价及以下，空单看 bid 是否打到限价及以上。"""
    if side == "buy":
        return ask <= limit_px + 1e-9
    return bid >= limit_px - 1e-9


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--config", type=Path, default=BACKEND / "config" / "limit_rebate_tmgm_demo.json")
    ap.add_argument("--live", action="store_true", help="真实挂一单（demo）")
    ap.add_argument("--wait-sec", type=float, default=None, help="监视秒数，默认=config limit_ttl")
    ap.add_argument("--force-side", choices=("buy", "sell"), default=None, help="忽略信号，强制方向（仅冒烟）")
    args = ap.parse_args()
    cfg = load_cfg(args.config)
    ttl = float(args.wait_sec if args.wait_sec is not None else cfg.get("limit_ttl_seconds", 30))
    lot = float(cfg["lot_per_trade"])
    tp_u = float(cfg["tp_usd_per_oz"])
    sl_u = float(cfg["sl_usd_per_oz"])
    magic = int((cfg.get("runner") or {}).get("magic", MAGIC))
    backtest_fill_prob = 0.99

    ensure_mt5()
    import MetaTrader5 as mt5

    sym = resolve_symbol()
    acc = account_snapshot()
    if cfg.get("runner", {}).get("require_demo_account") and acc.get("account_kind") != "demo":
        print(json.dumps({"error": "not_demo_account", "account": acc}, ensure_ascii=False))
        sys.exit(2)

    side_sign, meta = signal_side_v003(sym)
    q0 = snapshot_tick(mt5, sym)
    if q0 is None:
        print(json.dumps({"error": "no_tick"}, ensure_ascii=False))
        sys.exit(1)

    if args.force_side == "buy":
        side_sign = 1
    elif args.force_side == "sell":
        side_sign = -1

    report: dict = {
        "smoke": True,
        "ts_utc": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z",
        "symbol": sym,
        "login": acc.get("login"),
        "dry_run": not args.live,
        "ttl_sec": ttl,
        "backtest_assumed_fill_prob": backtest_fill_prob,
        "signal": {"side_sign": side_sign, "meta": meta},
        "probe_account_ok": acc.get("trade_allowed") and acc.get("terminal_trade_allowed"),
    }

    if side_sign == 0:
        report["path"] = "signal_flat"
        report["recommendation"] = "当前 5m 无方向信号；可用 --force-side buy|sell 测通路"
        out_path = BACKEND / "logs" / "rebate_drill" / f"smoke_{datetime.now(timezone.utc).strftime('%Y%m%d_%H%M%S')}.json"
        out_path.parent.mkdir(parents=True, exist_ok=True)
        out_path.write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8")
        print(json.dumps(report, indent=2, ensure_ascii=False))
        sys.exit(0)

    oside = "buy" if side_sign > 0 else "sell"
    px = passive_px(side_sign, q0)
    if side_sign > 0:
        sl, tp = px - sl_u, px + tp_u
    else:
        sl, tp = px + sl_u, px - tp_u
    theory = theory_bundle(
        signal_bar_time=meta.get("signal_bar_time"),
        signal_close=meta.get("signal_close"),
        bid=q0["bid"],
        ask=q0["ask"],
        passive_px=px,
        side=oside,
    )
    report["intent"] = {
        "side": oside,
        "limit_px": px,
        "sl": sl,
        "tp": tp,
        "lots": lot,
        "quote_submit": q0,
        "theory_submit": theory,
        "instant_touch_at_submit": _touch_theoretical(oside, px, q0["bid"], q0["ask"]),
    }

    append_event(
        cfg,
        {"kind": "smoke_begin", "dry_run": not args.live, "report_hint": "smoke_limit_rebate_path", **report["intent"]},
    )

    if not args.live:
        report["path"] = "dry_ok"
        report["order_submit"] = {"ok": True, "dry_run": True, "price": px}
        print(json.dumps(report, indent=2, ensure_ascii=False))
        return

    order_res = limit_order(side=oside, volume=lot, price=px, sl=sl, tp=tp, symbol=sym, comment="smoke_path")
    report["order_submit"] = order_res
    if not order_res.get("ok"):
        append_event(cfg, {"kind": "smoke_fail", "reason": "order_submit", "result": order_res})
        print(json.dumps(report, indent=2, ensure_ascii=False))
        sys.exit(1)

    ticket = int(order_res["order"])
    t0 = time.monotonic()
    min_bid, max_ask = q0["bid"], q0["ask"]
    min_ask, max_bid = q0["ask"], q0["bid"]
    touch_seen = False
    filled = False
    fill_px = None
    cancel_ok = None

    while time.monotonic() - t0 < ttl:
        time.sleep(1.0)
        q = snapshot_tick(mt5, sym)
        if q:
            min_bid = min(min_bid, q["bid"])
            max_ask = max(max_ask, q["ask"])
            min_ask = min(min_ask, q["ask"])
            max_bid = max(max_bid, q["bid"])
            if _bar_touch(oside, px, q["bid"], q["ask"]):
                touch_seen = True
        open_ids = {int(o["ticket"]) for o in list_orders(sym, magic)}
        if ticket not in open_ids:
            filled = True
            from datetime import timedelta

            now = datetime.now()
            deals = list(mt5.history_deals_get(now - timedelta(hours=1), now + timedelta(hours=1)) or [])
            for d in reversed(deals):
                if int(d.magic) != magic:
                    continue
                if int(getattr(d, "order", 0)) == ticket or int(d.position_id) > 0:
                    fill_px = float(d.price)
                    break
            break

    if not filled:
        cr = cancel_order(ticket)
        cancel_ok = cr.get("ok")
        time.sleep(0.5)
        open_ids = {int(o["ticket"]) for o in list_orders(sym, magic)}
        if ticket not in open_ids:
            filled = True

    if oside == "buy":
        path_touch = min_ask <= px + 1e-9 or touch_seen
    else:
        path_touch = max_bid >= px - 1e-9 or touch_seen

    report["watch"] = {
        "filled_within_ttl": filled,
        "cancel_after_ttl_ok": cancel_ok,
        "min_bid": round(min_bid, 5),
        "max_ask": round(max_ask, 5),
        "min_ask": round(min_ask, 5),
        "max_bid": round(max_bid, 5),
        "price_touched_during_ttl": path_touch,
        "fill_px": fill_px,
        "elapsed_sec": round(time.monotonic() - t0, 2),
    }
    if fill_px is not None:
        report["slip"] = {
            "fill_minus_intent_usd": round(fill_px - px, 5),
            "fill_minus_signal_close_usd": round(fill_px - float(meta.get("signal_close") or px), 5),
            "theory_vs_passive_at_submit_usd": theory.get("theory_vs_passive_usd"),
        }

    report["parity_note"] = {
        "live_limit_fill_rate_this_shot": 1.0 if filled else 0.0,
        "touch_implied_fill_prob_backtest": backtest_fill_prob if path_touch else 0.0,
        "gap": "回测触价后以 fill_prob 抽样成交；live 还取决于 queue / 最小量 / 经纪商撮合",
    }

    append_event(cfg, {"kind": "smoke_end", "ticket": ticket, **report})
    out_path = BACKEND / "logs" / "rebate_drill" / f"smoke_{datetime.now(timezone.utc).strftime('%Y%m%d_%H%M%S')}.json"
    out_path.write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8")
    report["report_file"] = str(out_path)
    print(json.dumps(report, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
