"""按 MT5 登录号记录已处理的平仓 deal，供连续止损风控与审计。"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

JOURNAL_PATH = Path(__file__).resolve().parent / "trade_journal.json"
MAX_SEEN = 2000


def _load() -> dict[str, Any]:
    if not JOURNAL_PATH.is_file():
        return {"accounts": {}}
    try:
        return json.loads(JOURNAL_PATH.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return {"accounts": {}}


def _save(data: dict[str, Any]) -> None:
    JOURNAL_PATH.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def _acct(login: int) -> dict[str, Any]:
    data = _load()
    key = str(int(login))
    ac = data.setdefault("accounts", {}).setdefault(
        key,
        {"seen_deal_tickets": [], "events": []},
    )
    return ac


def _persist_acct(login: int, ac: dict[str, Any]) -> None:
    data = _load()
    data.setdefault("accounts", {})[str(int(login))] = ac
    _save(data)


def append_event(
    login: int,
    *,
    kind: str,
    profit_usd: float | None = None,
    deal_ticket: int | None = None,
    note: str = "",
    source: str = "app",
) -> None:
    ac = _acct(login)
    ev = {
        "kind": kind,
        "profit_usd": profit_usd,
        "deal_ticket": deal_ticket,
        "note": note,
        "source": source,
    }
    events: list = ac.setdefault("events", [])
    events.append(ev)
    if len(events) > 500:
        ac["events"] = events[-500:]
    _persist_acct(login, ac)


def seen_deals(login: int) -> set[int]:
    ac = _acct(login)
    raw = ac.get("seen_deal_tickets") or []
    out: set[int] = set()
    for x in raw:
        try:
            out.add(int(x))
        except (TypeError, ValueError):
            continue
    return out


def clear_seen_deals(login: int) -> None:
    ac = _acct(login)
    ac["seen_deal_tickets"] = []
    _persist_acct(login, ac)


def journal_deal_tickets(login: int) -> set[int]:
    ac = _acct(login)
    out: set[int] = set()
    for ev in ac.get("events") or []:
        try:
            t = int(ev.get("deal_ticket") or 0)
            if t > 0:
                out.add(t)
        except (TypeError, ValueError):
            continue
    return out


def journal_has_deal(login: int, deal_ticket: int) -> bool:
    ac = _acct(login)
    for ev in ac.get("events") or []:
        try:
            if int(ev.get("deal_ticket") or 0) == int(deal_ticket):
                return True
        except (TypeError, ValueError):
            continue
    return False


def mark_deals_seen(login: int, tickets: list[int]) -> None:
    if not tickets:
        return
    ac = _acct(login)
    seen: list = ac.setdefault("seen_deal_tickets", [])
    for t in tickets:
        if t not in seen:
            seen.append(t)
    if len(seen) > MAX_SEEN:
        ac["seen_deal_tickets"] = seen[-MAX_SEEN:]
    _persist_acct(login, ac)
