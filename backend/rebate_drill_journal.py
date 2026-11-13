"""返佣演习 · 结构化 JSONL 日志（意图 / 报价 / 挂单 / 成交 / 滑点），供复盘与 parity。"""

from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from mt5_trading import MAGIC


def _utc_now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"


def journal_dir(cfg: dict) -> Path:
    j = cfg.get("journal") or {}
    base = Path(__file__).resolve().parent
    rel = j.get("dir", "logs/rebate_drill")
    p = Path(rel)
    if not p.is_absolute():
        p = base / p
    p.mkdir(parents=True, exist_ok=True)
    return p


def jsonl_path(cfg: dict) -> Path:
    j = cfg.get("journal") or {}
    name = j.get("jsonl_name", "events.jsonl")
    return journal_dir(cfg) / name


def new_intent_id() -> str:
    return uuid.uuid4().hex[:16]


def append_event(cfg: dict, record: dict[str, Any]) -> None:
    path = jsonl_path(cfg)
    row = {"ts_utc": _utc_now(), **record}
    with path.open("a", encoding="utf-8") as f:
        f.write(json.dumps(row, ensure_ascii=False) + "\n")


def theory_bundle(
    *,
    signal_bar_time: str | None,
    signal_close: float | None,
    bid: float,
    ask: float,
    passive_px: float,
    side: str,
) -> dict[str, Any]:
    mid = round((bid + ask) / 2.0, 5)
    spread = round(ask - bid, 5)
    return {
        "signal_bar_time": signal_bar_time,
        "signal_close": signal_close,
        "bid": bid,
        "ask": ask,
        "mid": mid,
        "spread_usd": spread,
        "passive_target_px": passive_px,
        "side": side,
        "passive_vs_mid_usd": round(passive_px - mid, 5),
        "theory_vs_passive_usd": round((signal_close or mid) - passive_px, 5)
        if signal_close is not None
        else None,
    }


def price_touched(side: str, limit_px: float, bid: float, ask: float) -> bool:
    if side == "buy":
        return ask <= limit_px + 1e-9
    return bid >= limit_px - 1e-9


def parity_theory_fields(theory: dict[str, Any] | None, fill_px: float) -> dict[str, Any]:
    """成交相对理论/信号价的偏差（美元/盎司）。"""
    if not theory:
        return {}
    sc = theory.get("signal_close")
    passive = theory.get("passive_target_px")
    mid = theory.get("mid")
    out: dict[str, Any] = {}
    if passive is not None:
        out["fill_minus_passive_usd"] = round(fill_px - float(passive), 5)
    if sc is not None:
        out["fill_minus_signal_close_usd"] = round(fill_px - float(sc), 5)
    if mid is not None:
        out["fill_minus_mid_usd"] = round(fill_px - float(mid), 5)
    return out


def lookup_deal_for_order(
    order_ticket: int,
    *,
    magic: int,
    symbol: str,
    hours_back: float = 2.0,
) -> dict[str, Any] | None:
    """挂单 ticket 是否在近期成交（history_deals 的 order 字段）。"""
    from datetime import datetime, timedelta

    import MetaTrader5 as mt5

    from mt5_bridge import ensure_mt5

    ensure_mt5()
    entry_in = int(getattr(mt5, "DEAL_ENTRY_IN", 0))
    t0 = datetime.now() - timedelta(hours=hours_back)
    t1 = datetime.now() + timedelta(minutes=5)
    for d in reversed(list(mt5.history_deals_get(t0, t1) or [])):
        if int(d.magic) != magic:
            continue
        if str(d.symbol) != symbol and "XAU" not in str(d.symbol):
            continue
        if int(getattr(d, "order", 0)) != int(order_ticket):
            continue
        if int(d.entry) != entry_in:
            continue
        deal_buy = int(getattr(mt5, "DEAL_TYPE_BUY", 0))
        side = "buy" if int(d.type) == deal_buy else "sell"
        return {
            "deal_ticket": int(d.ticket),
            "position_id": int(d.position_id),
            "fill_px": float(d.price),
            "lots": float(d.volume),
            "side": side,
            "deal_time_unix": int(d.time),
        }
    return None


def slip_vs_intent(*, side: str, intent_px: float, fill_px: float) -> dict[str, float]:
    """正数 = 对买方更差 / 对卖方更差（美元/盎司）。"""
    if side == "buy":
        adverse = fill_px - intent_px
    else:
        adverse = intent_px - fill_px
    return {
        "fill_minus_intent_usd": round(fill_px - intent_px, 5),
        "adverse_slip_usd": round(adverse, 5),
    }


def sync_entry_deals(
    cfg: dict,
    *,
    login: int,
    symbol: str,
    seen_tickets: set[int],
    intent_by_position: dict[int, str],
    order_to_intent: dict[int, str] | None = None,
) -> tuple[set[int], list[dict]]:
    """拉取新 IN deal（magic=APP），记滑点。"""
    from datetime import datetime, timedelta

    import MetaTrader5 as mt5

    from mt5_bridge import ensure_mt5

    ensure_mt5()
    magic = int((cfg.get("runner") or {}).get("magic", MAGIC))
    date_from = datetime.now() - timedelta(days=3)
    date_to = datetime.now() + timedelta(days=1)
    rows = list(mt5.history_deals_get(date_from, date_to) or [])
    entry_in = int(getattr(mt5, "DEAL_ENTRY_IN", 0))
    out: list[dict] = []
    new_seen = set(seen_tickets)
    for d in rows:
        ticket = int(d.ticket)
        if ticket in seen_tickets:
            continue
        if int(d.magic) != magic:
            continue
        if str(d.symbol) != symbol and "XAU" not in str(d.symbol):
            continue
        if int(d.entry) != entry_in:
            continue
        fill_px = float(d.price)
        deal_buy = int(getattr(mt5, "DEAL_TYPE_BUY", 0))
        side = "buy" if int(d.type) == deal_buy else "sell"
        intent_id = intent_by_position.get(int(d.position_id), "")
        if not intent_id and order_to_intent:
            oid = int(getattr(d, "order", 0) or 0)
            intent_id = order_to_intent.get(oid, "")
            if intent_id:
                intent_by_position[int(d.position_id)] = intent_id
        row = {
            "kind": "deal_entry",
            "login": login,
            "deal_ticket": ticket,
            "position_id": int(d.position_id),
            "intent_id": intent_id,
            "side": side,
            "lots": float(d.volume),
            "fill_px": fill_px,
            "profit_usd": float(d.profit),
            "commission": float(d.commission),
            "deal_time_unix": int(d.time),
        }
        append_event(cfg, row)
        out.append(row)
        new_seen.add(ticket)
    return new_seen, out


def sync_exit_deals(
    cfg: dict,
    *,
    login: int,
    symbol: str,
    seen_tickets: set[int],
    intent_by_position: dict[int, str],
) -> tuple[set[int], list[dict]]:
    """平仓 deal（TP/SL/手工）。"""
    from datetime import datetime, timedelta

    import MetaTrader5 as mt5

    from mt5_bridge import ensure_mt5

    ensure_mt5()
    magic = int((cfg.get("runner") or {}).get("magic", MAGIC))
    entry_out = int(getattr(mt5, "DEAL_ENTRY_OUT", 1))
    t0 = datetime.now() - timedelta(days=3)
    t1 = datetime.now() + timedelta(days=1)
    out: list[dict] = []
    new_seen = set(seen_tickets)
    for d in mt5.history_deals_get(t0, t1) or []:
        ticket = int(d.ticket)
        if ticket in seen_tickets:
            continue
        if int(d.magic) != magic:
            continue
        if str(d.symbol) != symbol and "XAU" not in str(d.symbol):
            continue
        if int(d.entry) != entry_out:
            continue
        pid = int(d.position_id)
        row = {
            "kind": "deal_exit",
            "login": login,
            "deal_ticket": ticket,
            "position_id": pid,
            "intent_id": intent_by_position.get(pid, ""),
            "lots": float(d.volume),
            "exit_px": float(d.price),
            "profit_usd": float(d.profit),
            "commission": float(d.commission),
            "swap": float(getattr(d, "swap", 0) or 0),
            "deal_time_unix": int(d.time),
            "comment": str(getattr(d, "comment", "") or ""),
        }
        append_event(cfg, row)
        out.append(row)
        new_seen.add(ticket)
    return new_seen, out
