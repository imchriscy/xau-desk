"""核对 MT5 平仓 deal 时间（BJT）与连损重放结果。在 backend 目录: py -3 scripts/debug_mt5_deals.py"""
from __future__ import annotations

import json
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

BJT = timezone(timedelta(hours=8))


def main() -> None:
    from mt5_trading import list_exit_deals_since, resolve_symbol
    from risk_engine import _replay_streak_from_deals, session_key_for, session_window_bjt

    sk = session_key_for()
    start, end = session_window_bjt(sk)
    since = int(start.timestamp())
    sym = resolve_symbol()
    deals = list_exit_deals_since(since, sym)
    cl, tier3 = _replay_streak_from_deals(deals)
    print(f"symbol={sym} session={sk} deals={len(deals)} replay_cl={cl} tier3={tier3}")
    print("--- last 12 exit deals (ticket | BJT | profit | kind | magic) ---")
    for d in deals[-12:]:
        ts = datetime.fromtimestamp(int(d["time"]), tz=BJT).strftime("%Y-%m-%d %H:%M:%S")
        print(
            f"{d['ticket']} | {ts} BJT | {d['profit']:.2f} | {d.get('close_kind')} | magic={d.get('magic')}"
        )
    print("--- raw MT5 last deals (any symbol, entry OUT) ---")
    import MetaTrader5 as mt5

    mt5.initialize()
    rows = mt5.history_deals_get(datetime.now() - timedelta(days=1), datetime.now() + timedelta(minutes=5))
    if not rows:
        print("no history rows")
        return
    out = [d for d in rows if int(d.entry) in (1, 3)]
    out.sort(key=lambda x: x.time)
    for d in out[-12:]:
        ts = datetime.fromtimestamp(int(d.time), tz=BJT).strftime("%Y-%m-%d %H:%M:%S")
        print(f"{d.ticket} | {ts} BJT | {d.symbol} | profit={d.profit:.2f} reason={d.reason} magic={d.magic}")


if __name__ == "__main__":
    main()
