#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""探测本机 MT5 是否已登录 · 品种点差 · 是否模拟盘。"""

from __future__ import annotations

import json
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))

from mt5_bridge import ensure_mt5, resolve_symbol  # noqa: E402
from mt5_trading import account_snapshot  # noqa: E402


def main() -> None:
    ensure_mt5()
    import MetaTrader5 as mt5

    sym = resolve_symbol()
    info = mt5.symbol_info(sym)
    snap = account_snapshot()
    spread_usd = None
    if info:
        spread_usd = round(float(info.ask - info.bid), 4)
    out = {
        **snap,
        "symbol": sym,
        "spread_points": int(info.spread) if info else None,
        "bid": float(info.bid) if info else None,
        "ask": float(info.ask) if info else None,
        "spread_usd": spread_usd,
        "terminal_path": __import__("os").environ.get("MT5_TERMINAL_PATH", ""),
    }
    print(json.dumps(out, indent=2, ensure_ascii=False))
    if snap.get("account_kind") == "real":
        print("\n[WARN] 当前为实盘账户 · 演习请切换 TMGM 模拟盘后再跑 runner", file=sys.stderr)


if __name__ == "__main__":
    main()
