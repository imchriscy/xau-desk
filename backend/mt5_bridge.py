"""本地 MT5 · XAU K 线 / 报价 / 延迟测量。"""

from __future__ import annotations

import os
import time
from dataclasses import dataclass
from typing import Any

_initialized = False
_resolved_symbol: str | None = None

TIMEFRAMES = ("1m", "3m", "5m", "15m", "30m", "1h", "4h", "1d")

# MT5 原生周期，保证切换流畅且与终端一致
TF_TO_MT5: dict[str, int] = {}
BAR_COUNTS: dict[str, int] = {
    "1m": 2500,
    "3m": 1800,
    "5m": 1500,
    "15m": 1000,
    "30m": 800,
    "1h": 700,
    "4h": 500,
    "1d": 400,
}


def _mt5():
    import MetaTrader5 as mt5  # type: ignore

    return mt5


def _bind_timeframes() -> None:
    global TF_TO_MT5
    if TF_TO_MT5:
        return
    mt5 = _mt5()
    TF_TO_MT5.update(
        {
            "1m": mt5.TIMEFRAME_M1,
            "3m": mt5.TIMEFRAME_M3,
            "5m": mt5.TIMEFRAME_M5,
            "15m": mt5.TIMEFRAME_M15,
            "30m": mt5.TIMEFRAME_M30,
            "1h": mt5.TIMEFRAME_H1,
            "4h": mt5.TIMEFRAME_H4,
            "1d": mt5.TIMEFRAME_D1,
        }
    )


def ensure_mt5() -> None:
    global _initialized
    if _initialized:
        return
    mt5 = _mt5()
    _bind_timeframes()
    path = os.environ.get("MT5_TERMINAL_PATH", r"C:\Program Files\MetaTrader 5\terminal64.exe")
    if os.path.isfile(path):
        ok = mt5.initialize(path=path)
    else:
        ok = mt5.initialize()
    if not ok:
        raise RuntimeError(f"mt5.initialize failed: {mt5.last_error()}")
    _initialized = True


def resolve_symbol() -> str:
    global _resolved_symbol
    if _resolved_symbol:
        return _resolved_symbol
    ensure_mt5()
    mt5 = _mt5()
    preferred = os.environ.get("MT5_SYMBOL", "XAUUSD").strip()
    candidates = [preferred, "XAUUSD", "XAUUSDm", "GOLD", "XAUUSD.", "XAUUSD#"]
    seen: set[str] = set()
    for name in candidates:
        if not name or name in seen:
            continue
        seen.add(name)
        info = mt5.symbol_info(name)
        if info is not None:
            mt5.symbol_select(name, True)
            _resolved_symbol = name
            return name
    for sym in mt5.symbols_get() or []:
        n = sym.name
        u = n.upper()
        if "XAU" in u and "USD" in u:
            mt5.symbol_select(n, True)
            _resolved_symbol = n
            return n
    raise RuntimeError("未找到 XAUUSD 类品种；请设置 MT5_SYMBOL 或在 MT5 市场报价中启用黄金")


@dataclass
class LatencySample:
    mt5_ms: float
    detail: str


def measure_tick_latency(symbol: str) -> LatencySample:
    ensure_mt5()
    mt5 = _mt5()
    t0 = time.perf_counter()
    tick = mt5.symbol_info_tick(symbol)
    t1 = time.perf_counter()
    if tick is None:
        raise RuntimeError(f"symbol_info_tick failed: {mt5.last_error()}")
    return LatencySample(mt5_ms=(t1 - t0) * 1000.0, detail="tick")


def fetch_bars(symbol: str, timeframe: str, count: int | None = None) -> tuple[list[dict[str, Any]], LatencySample]:
    ensure_mt5()
    mt5 = _mt5()
    _bind_timeframes()
    if timeframe not in TF_TO_MT5:
        raise ValueError(f"unsupported timeframe: {timeframe}")
    n = count or BAR_COUNTS.get(timeframe, 800)
    n = max(50, min(int(n), 5000))
    t0 = time.perf_counter()
    rates = mt5.copy_rates_from_pos(symbol, TF_TO_MT5[timeframe], 0, n)
    t1 = time.perf_counter()
    if rates is None or len(rates) == 0:
        raise RuntimeError(f"copy_rates_from_pos({timeframe}) failed: {mt5.last_error()}")
    candles: list[dict[str, Any]] = []
    for r in rates:
        candles.append(
            {
                "time": int(r["time"]),
                "open": float(r["open"]),
                "high": float(r["high"]),
                "low": float(r["low"]),
                "close": float(r["close"]),
                "volume": float(r["tick_volume"]),
            }
        )
    return candles, LatencySample(mt5_ms=(t1 - t0) * 1000.0, detail=f"bars:{timeframe}")


def fetch_quote(symbol: str) -> dict[str, Any]:
    lat = measure_tick_latency(symbol)
    mt5 = _mt5()
    tick = mt5.symbol_info_tick(symbol)
    if tick is None:
        raise RuntimeError(f"tick missing: {mt5.last_error()}")
    mid = (tick.bid + tick.ask) / 2.0
    return {
        "symbol": symbol,
        "bid": float(tick.bid),
        "ask": float(tick.ask),
        "last": float(mid),
        "time": int(tick.time),
        "mt5_ms": round(lat.mt5_ms, 2),
    }


def terminal_status() -> dict[str, Any]:
    try:
        ensure_mt5()
        mt5 = _mt5()
        sym = resolve_symbol()
        acc = mt5.account_info()
        ti = mt5.terminal_info()
        return {
            "connected": True,
            "symbol": sym,
            "login": acc.login if acc else None,
            "server": acc.server if acc else None,
            "terminal": ti.name if ti else None,
            "trade_allowed": bool(ti.trade_allowed) if ti else None,
        }
    except Exception as e:
        return {"connected": False, "error": str(e)}
