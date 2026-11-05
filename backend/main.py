"""Win Trade Terminal · MT5 本地网关 (FastAPI)."""

from __future__ import annotations

import time
from functools import lru_cache
from typing import Any

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware

from mt5_bridge import BAR_COUNTS, TIMEFRAMES, fetch_bars, fetch_quote, measure_tick_latency, resolve_symbol, terminal_status

app = FastAPI(title="MING Win Trade MT5 Gateway", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

_bars_cache: dict[tuple[str, str, int], tuple[float, list[dict[str, Any]]]] = {}
_CACHE_TTL = 0.35  # 同周期短缓存，减轻 MT5 压力、切换更顺


@lru_cache(maxsize=1)
def _symbol() -> str:
    return resolve_symbol()


@app.get("/api/health")
def health() -> dict[str, Any]:
    return {"ok": True, "service": "mt5-gateway"}


@app.get("/api/mt5/status")
def mt5_status() -> dict[str, Any]:
    return terminal_status()


@app.get("/api/ping")
def ping() -> dict[str, Any]:
    """往返测速：响应含 MT5 tick 调用耗时 (ms)。"""
    t0 = time.perf_counter()
    try:
        sym = _symbol()
        lat = measure_tick_latency(sym)
        server_ms = (time.perf_counter() - t0) * 1000.0
        return {
            "ok": True,
            "symbol": sym,
            "mt5_ms": round(lat.mt5_ms, 2),
            "server_ms": round(server_ms, 2),
            "ts": time.time(),
        }
    except Exception as e:
        raise HTTPException(status_code=503, detail=str(e)) from e


@app.get("/api/quote")
def quote() -> dict[str, Any]:
    try:
        return fetch_quote(_symbol())
    except Exception as e:
        raise HTTPException(status_code=503, detail=str(e)) from e


@app.get("/api/bars")
def bars(
    timeframe: str = Query(..., description="1m|3m|5m|15m|30m|1h|4h|1d"),
    count: int | None = Query(None, ge=50, le=5000),
) -> dict[str, Any]:
    if timeframe not in TIMEFRAMES:
        raise HTTPException(status_code=400, detail=f"timeframe must be one of {TIMEFRAMES}")
    sym = _symbol()
    n = count or BAR_COUNTS.get(timeframe, 800)
    key = (sym, timeframe, n)
    now = time.time()
    cached = _bars_cache.get(key)
    if cached and (now - cached[0]) < _CACHE_TTL:
        data = cached[1]
        return {
            "symbol": sym,
            "timeframe": timeframe,
            "count": len(data),
            "candles": data,
            "mt5_ms": 0.0,
            "cached": True,
        }
    try:
        data, lat = fetch_bars(sym, timeframe, n)
        _bars_cache[key] = (now, data)
        return {
            "symbol": sym,
            "timeframe": timeframe,
            "count": len(data),
            "candles": data,
            "mt5_ms": round(lat.mt5_ms, 2),
            "cached": False,
        }
    except Exception as e:
        raise HTTPException(status_code=503, detail=str(e)) from e


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("main:app", host="127.0.0.1", port=5191, reload=False)
