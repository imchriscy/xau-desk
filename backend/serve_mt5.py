"""MT5 网关 · 仅依赖 MetaTrader5 + 标准库（免 pip 装 FastAPI）。"""

from __future__ import annotations

import json
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

from mt5_bridge import BAR_COUNTS, TIMEFRAMES, fetch_bars, fetch_quote, measure_tick_latency, resolve_symbol, terminal_status
from mt5_trading import (
    account_snapshot,
    cancel_order,
    close_position,
    fetch_exit_deal,
    limit_order,
    list_orders,
    list_positions,
    login_account,
    market_order,
    modify_order_sl_tp,
    modify_sl_tp,
    pending_order,
)
from dataclasses import asdict

from risk_engine import (
    apply_save_config,
    assert_trading_allowed,
    check_order_allowed,
    confirm_baseline,
    get_config,
    ingest_streak_close_deal,
    risk_status,
    resync_streak_losses,
    sync_consecutive_losses,
)

HOST = "127.0.0.1"
PORT = 5191
GATEWAY_VERSION = "0.5.5-streak-tiers-config"

_bars_cache: dict[tuple[str, str, int], tuple[float, list]] = {}
_CACHE_TTL_DEFAULT = 0.35
_CACHE_TTL_TF = {"1m": 0.1, "3m": 0.15, "5m": 0.2}
_symbol: str | None = None


def _risk_audit_response(qs: dict[str, list[str]]) -> dict:
    from risk_event_log import audit_bundle

    limit = int((qs.get("limit") or ["80"])[0])
    include_system = (qs.get("system") or ["1"])[0] != "0"
    login: int | None = None
    try:
        login = int(account_snapshot()["login"])
    except Exception:
        pass
    if include_system:
        bundle = audit_bundle(None, limit=limit * 2)
        if login is not None:
            bundle["events"] = [
                e for e in bundle["events"] if int(e.get("login", 0)) in (0, login)
            ][:limit]
        else:
            bundle["events"] = bundle["events"][:limit]
    else:
        bundle = audit_bundle(login, limit=limit)
    bundle["login"] = login
    bundle["gateway_version"] = GATEWAY_VERSION
    return bundle


def _sym() -> str:
    global _symbol
    if _symbol is None:
        _symbol = resolve_symbol()
    return _symbol


class Handler(BaseHTTPRequestHandler):
    server_version = "MING-MT5-Gateway/0.1"

    def log_message(self, fmt: str, *args) -> None:
        return

    def _cors(self) -> None:
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, *")

    def _json(self, code: int, payload: dict) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self._cors()
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self) -> None:
        self.send_response(204)
        self._cors()
        self.end_headers()

    def _read_json(self) -> dict:
        n = int(self.headers.get("Content-Length") or 0)
        if n <= 0:
            return {}
        raw = self.rfile.read(n)
        return json.loads(raw.decode("utf-8"))

    def do_POST(self) -> None:
        path = urlparse(self.path).path
        try:
            body = self._read_json()
            if path == "/api/account/login":
                snap = login_account(
                    login=int(body["login"]),
                    password=str(body.get("password") or ""),
                    server=str(body["server"]),
                )
                global _symbol
                _symbol = snap.get("symbol") or _sym()
                self._json(200, {"ok": True, "account": snap})
                return
            if path == "/api/order/market":
                sym = _sym()
                acc = account_snapshot()
                allow_demo = bool(body.get("allow_demo_mt5"))
                if acc["account_kind"] != "real" and not allow_demo:
                    self._json(
                        403,
                        {"detail": "演示账户默认仅前端模拟；若需 MT5 模拟仓成交请在请求中 allow_demo_mt5 或切换实盘账户"},
                    )
                    return
                side = str(body["side"])
                qt = fetch_quote(sym)
                entry = float(qt["ask"] if side == "buy" else qt["bid"])
                sl = body.get("sl")
                tp = body.get("tp")
                login = int(acc["login"])
                check_order_allowed(
                    login=login,
                    side=side,
                    lots=float(body["lots"]),
                    entry=entry,
                    sl=float(sl) if sl is not None else None,
                    equity=float(acc["equity"]),
                )
                out = market_order(
                    side=str(body["side"]),
                    volume=float(body["lots"]),
                    sl=sl,
                    tp=tp,
                    symbol=sym,
                    comment=str(body.get("comment") or "ming_win"),
                )
                self._json(200 if out["ok"] else 502, out)
                return
            if path == "/api/order/limit":
                sym = _sym()
                acc = account_snapshot()
                allow_demo = bool(body.get("allow_demo_mt5"))
                if acc["account_kind"] != "real" and not allow_demo:
                    self._json(403, {"detail": "演示账户请启用 MT5 模拟仓或切换实盘"})
                    return
                px = float(body["price"])
                sl = body.get("sl")
                tp = body.get("tp")
                login = int(acc["login"])
                check_order_allowed(
                    login=login,
                    side=str(body["side"]),
                    lots=float(body["lots"]),
                    entry=px,
                    sl=float(sl) if sl is not None else None,
                    equity=float(acc["equity"]),
                )
                out = limit_order(
                    side=str(body["side"]),
                    volume=float(body["lots"]),
                    price=px,
                    sl=sl,
                    tp=tp,
                    symbol=sym,
                )
                self._json(200 if out["ok"] else 502, out)
                return
            if path == "/api/order/pending":
                sym = _sym()
                acc = account_snapshot()
                allow_demo = bool(body.get("allow_demo_mt5"))
                if acc["account_kind"] != "real" and not allow_demo:
                    self._json(403, {"detail": "演示账户请启用 MT5 模拟仓或切换实盘"})
                    return
                mode = str(body.get("mode") or "limit")
                side = str(body["side"])
                px = float(body["price"])
                sl = body.get("sl")
                tp = body.get("tp")
                login = int(acc["login"])
                check_order_allowed(
                    login=login,
                    side=side,
                    lots=float(body["lots"]),
                    entry=px,
                    sl=float(sl) if sl is not None else None,
                    equity=float(acc["equity"]),
                )
                out = pending_order(
                    mode=mode,
                    side=side,
                    volume=float(body["lots"]),
                    price=px,
                    stoplimit=float(body["stoplimit"]) if body.get("stoplimit") is not None else None,
                    sl=sl,
                    tp=tp,
                    symbol=sym,
                )
                self._json(200 if out["ok"] else 502, out)
                return
            if path == "/api/risk/config":
                try:
                    acc = account_snapshot()
                    login = int(acc["login"])
                    cfg = get_config(login)
                    for k in (
                        "daily_enabled",
                        "per_trade_loss_cap_usd",
                        "per_trade_loss_cap_pct",
                        "daily_loss_cap_usd",
                        "daily_loss_cap_pct",
                        "streak_enabled",
                        "streak_tier1_losses",
                        "streak_tier1_pause_minutes",
                        "streak_tier2_losses",
                        "streak_tier2_pause_minutes",
                        "require_stop_loss",
                        "virtual_equity_usd",
                        "margin_cap_factor",
                        "max_combined_slots",
                        "app_magic_only",
                    ):
                        if k in body:
                            setattr(cfg, k, body[k])
                    eq = float(acc["equity"])
                    cfg = apply_save_config(cfg, login, equity=eq)
                    self._json(200, {"ok": True, "config": asdict(cfg)})
                except PermissionError as e:
                    self._json(403, {"detail": str(e)})
                return
            if path == "/api/risk/resync-streak":
                acc = account_snapshot()
                login = int(acc["login"])
                rebuild = bool(body.get("rebuild"))
                out = resync_streak_losses(login, rebuild=rebuild)
                st = risk_status(float(acc["equity"]), login)
                self._json(200, {"ok": True, "streak_sync": out, "status": st})
                return
            if path == "/api/risk/confirm":
                try:
                    acc = account_snapshot()
                    login = int(acc["login"])
                    eq = float(body.get("equity") or acc["equity"])
                    cfg = confirm_baseline(eq, login)
                    self._json(200, {"ok": True, "config": asdict(cfg)})
                except PermissionError as e:
                    self._json(403, {"detail": str(e)})
                return
            if path == "/api/order/close":
                acc = account_snapshot()
                assert_trading_allowed(int(acc["login"]))
                out = close_position(int(body["ticket"]))
                if out.get("ok"):
                    login = int(acc["login"])
                    deal_row = fetch_exit_deal(
                        deal_ticket=out.get("deal"),
                        position_id=out.get("position_id"),
                    )
                    if deal_row:
                        out["streak_ingest"] = ingest_streak_close_deal(
                            login,
                            deal_ticket=int(deal_row["ticket"]),
                            profit=float(deal_row["profit"]),
                            close_kind=str(deal_row.get("close_kind") or "manual"),
                        )
                    out["streak_sync"] = sync_consecutive_losses(login)
                self._json(200 if out["ok"] else 502, out)
                return
            if path == "/api/position/modify":
                acc = account_snapshot()
                assert_trading_allowed(int(acc["login"]))
                out = modify_sl_tp(
                    int(body["ticket"]),
                    sl=body.get("sl"),
                    tp=body.get("tp"),
                )
                self._json(200 if out["ok"] else 502, out)
                return
            if path == "/api/order/modify":
                acc = account_snapshot()
                assert_trading_allowed(int(acc["login"]))
                price = body.get("price")
                out = modify_order_sl_tp(
                    int(body["ticket"]),
                    price=float(price) if price is not None else None,
                    sl=body.get("sl"),
                    tp=body.get("tp"),
                )
                self._json(200 if out["ok"] else 502, out)
                return
            if path == "/api/order/cancel":
                acc = account_snapshot()
                assert_trading_allowed(int(acc["login"]))
                out = cancel_order(int(body["ticket"]))
                self._json(200 if out["ok"] else 502, out)
                return
            self._json(404, {"detail": "not found"})
        except PermissionError as e:
            self._json(403, {"detail": str(e)})
        except Exception as e:
            _log_gateway_exception(path, e)
            self._json(503, {"detail": str(e)})

    def do_GET(self) -> None:
        path = urlparse(self.path).path
        qs = parse_qs(urlparse(self.path).query)

        try:
            if path == "/api/health":
                self._json(200, {"ok": True, "service": "mt5-gateway", "version": GATEWAY_VERSION})
                return
            if path == "/api/version":
                self._json(
                    200,
                    {
                        "version": GATEWAY_VERSION,
                        "features": [
                            "account",
                            "detect",
                            "login",
                            "order",
                            "pending",
                            "order_modify",
                            "positions",
                            "risk",
                        ],
                    },
                )
                return
            if path == "/api/mt5/status":
                self._json(200, terminal_status())
                return
            if path == "/api/ping":
                t0 = time.perf_counter()
                sym = _sym()
                lat = measure_tick_latency(sym)
                server_ms = (time.perf_counter() - t0) * 1000.0
                self._json(
                    200,
                    {
                        "ok": True,
                        "symbol": sym,
                        "mt5_ms": round(lat.mt5_ms, 2),
                        "server_ms": round(server_ms, 2),
                        "ts": time.time(),
                    },
                )
                return
            if path == "/api/quote":
                self._json(200, fetch_quote(_sym()))
                return
            if path == "/api/account":
                self._json(200, account_snapshot())
                return
            if path == "/api/account/detect":
                snap = account_snapshot()
                snap["online"] = True
                self._json(200, snap)
                return
            if path == "/api/risk/status":
                acc = account_snapshot()
                audit_limit = int((qs.get("audit_limit") or ["0"])[0] or 0)
                self._json(
                    200,
                    risk_status(
                        float(acc["equity"]),
                        int(acc["login"]),
                        audit_limit=audit_limit,
                        gateway_version=GATEWAY_VERSION if audit_limit > 0 else None,
                    ),
                )
                return
            if path == "/api/risk/mt5-deals-verify":
                from risk_engine import _replay_streak_from_deals, session_key_for, session_window_bjt
                from mt5_trading import list_exit_deals_since, resolve_symbol

                sk = session_key_for()
                start, end = session_window_bjt(sk)
                since = int(start.timestamp())
                until = int(end.timestamp())
                sym = resolve_symbol()
                deals = list_exit_deals_since(since, sym, until_unix=until)
                cl, tier3 = _replay_streak_from_deals(deals)
                tail = [
                    {
                        "ticket": d["ticket"],
                        "time_bjt": d.get("time_bjt"),
                        "profit": d["profit"],
                        "close_kind": d.get("close_kind"),
                        "magic": d.get("magic"),
                    }
                    for d in deals[-12:]
                ]
                self._json(
                    200,
                    {
                        "gateway_version": GATEWAY_VERSION,
                        "symbol": sym,
                        "session_key": sk,
                        "deals_in_window": len(deals),
                        "consecutive_losses_replay": cl,
                        "newest": tail[-1] if tail else None,
                        "tail": tail,
                        "note": "tail=本窗最近平仓；time_bjt 来自 MT5 deal 时间（非审计写入时间）",
                    },
                )
                return
            if path in ("/api/risk/events", "/api/risk/audit"):
                try:
                    self._json(200, _risk_audit_response(qs))
                except Exception as ex:
                    self._json(
                        500,
                        {
                            "detail": str(ex),
                            "events": [],
                            "integrity": {"valid": False, "tip": "读取日志失败"},
                            "gateway_version": GATEWAY_VERSION,
                        },
                    )
                return
            if path == "/api/positions":
                sym = (qs.get("symbol") or [None])[0]
                self._json(200, {"positions": list_positions(sym)})
                return
            if path == "/api/orders":
                sym = (qs.get("symbol") or [None])[0]
                self._json(200, {"orders": list_orders(sym)})
                return
            if path == "/api/bars":
                tf = (qs.get("timeframe") or [""])[0]
                if tf not in TIMEFRAMES:
                    self._json(400, {"detail": f"timeframe must be one of {TIMEFRAMES}"})
                    return
                count_raw = (qs.get("count") or [""])[0]
                n = int(count_raw) if count_raw.isdigit() else BAR_COUNTS.get(tf, 800)
                sym = _sym()
                key = (sym, tf, n)
                now = time.time()
                ttl = _CACHE_TTL_TF.get(tf, _CACHE_TTL_DEFAULT)
                cached = _bars_cache.get(key)
                if cached and (now - cached[0]) < ttl:
                    data = cached[1]
                    self._json(
                        200,
                        {
                            "symbol": sym,
                            "timeframe": tf,
                            "count": len(data),
                            "candles": data,
                            "mt5_ms": 0.0,
                            "cached": True,
                        },
                    )
                    return
                data, lat = fetch_bars(sym, tf, n)
                _bars_cache[key] = (now, data)
                self._json(
                    200,
                    {
                        "symbol": sym,
                        "timeframe": tf,
                        "count": len(data),
                        "candles": data,
                        "mt5_ms": round(lat.mt5_ms, 2),
                        "cached": False,
                    },
                )
                return
            self._json(404, {"detail": "not found"})
        except Exception as e:
            _log_gateway_exception(path, e)
            self._json(503, {"detail": str(e)})


def _log_gateway_exception(path: str, e: Exception) -> None:
    try:
        from risk_event_log import log_system_event

        log_system_event("gateway_exception", detail=str(e)[:500], payload={"path": path})
    except Exception:
        pass


def main() -> None:
    httpd = ThreadingHTTPServer((HOST, PORT), Handler)
    print(f"[mt5-gateway] http://{HOST}:{PORT}/api/mt5/status")
    httpd.serve_forever()


if __name__ == "__main__":
    main()
