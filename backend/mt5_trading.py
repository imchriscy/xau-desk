"""MT5 账户 / 持仓 / 下单（Win Trade Terminal）。"""

from __future__ import annotations

import time
from typing import Any

from mt5_bridge import ensure_mt5, resolve_symbol

MAGIC = 8805190


def _mt5():
    import MetaTrader5 as mt5  # type: ignore

    return mt5


def _filling(mt5, symbol: str) -> int:
    info = mt5.symbol_info(symbol)
    if info is None:
        return mt5.ORDER_FILLING_RETURN
    fm = int(info.filling_mode)
    if fm & 2:
        return mt5.ORDER_FILLING_IOC
    if fm & 1:
        return mt5.ORDER_FILLING_FOK
    return mt5.ORDER_FILLING_RETURN


def _deviation(symbol: str) -> int:
    mt5 = _mt5()
    info = mt5.symbol_info(symbol)
    if info is None:
        return 30
    spread_pts = max(int(getattr(info, "spread", 0)), 1)
    return min(max(spread_pts + 5, 10), 80)


def account_kind(trade_mode: int) -> str:
    mt5 = _mt5()
    if trade_mode == mt5.ACCOUNT_TRADE_MODE_REAL:
        return "real"
    return "demo"


def account_snapshot() -> dict[str, Any]:
    ensure_mt5()
    mt5 = _mt5()
    acc = mt5.account_info()
    ti = mt5.terminal_info()
    if acc is None:
        raise RuntimeError(f"account_info failed: {mt5.last_error()}")
    kind = account_kind(int(acc.trade_mode))
    return {
        "login": int(acc.login),
        "server": str(acc.server),
        "name": str(acc.name or ""),
        "company": str(acc.company or ""),
        "currency": str(acc.currency or "USD"),
        "balance": float(acc.balance),
        "equity": float(acc.equity),
        "margin": float(acc.margin),
        "margin_free": float(acc.margin_free),
        "profit": float(acc.profit),
        "leverage": int(acc.leverage),
        "account_kind": kind,
        "account_kind_label": "实盘" if kind == "real" else "模拟",
        "trade_allowed": bool(acc.trade_allowed),
        "trade_expert": bool(acc.trade_expert),
        "terminal_trade_allowed": bool(ti.trade_allowed) if ti else None,
    }


def login_account(*, login: int, password: str, server: str) -> dict[str, Any]:
    ensure_mt5()
    mt5 = _mt5()
    ok = mt5.login(login=int(login), password=str(password), server=str(server))
    if not ok:
        err = mt5.last_error()
        raise RuntimeError(f"login failed: {err}")
    # 切换账户后重新解析品种
    import mt5_bridge

    mt5_bridge._resolved_symbol = None  # noqa: SLF001
    sym = resolve_symbol()
    snap = account_snapshot()
    snap["symbol"] = sym
    return snap


def _order_mode_side(otype: int) -> tuple[str, str]:
    mt5 = _mt5()
    m = {
        int(mt5.ORDER_TYPE_BUY_LIMIT): ("limit", "buy"),
        int(mt5.ORDER_TYPE_SELL_LIMIT): ("limit", "sell"),
        int(mt5.ORDER_TYPE_BUY_STOP): ("stop", "buy"),
        int(mt5.ORDER_TYPE_SELL_STOP): ("stop", "sell"),
        int(mt5.ORDER_TYPE_BUY_STOP_LIMIT): ("stop_limit", "buy"),
        int(mt5.ORDER_TYPE_SELL_STOP_LIMIT): ("stop_limit", "sell"),
    }
    return m.get(int(otype), ("limit", "buy"))


def account_leverage() -> int:
    ensure_mt5()
    acc = _mt5().account_info()
    if acc is None:
        return 1
    return max(int(acc.leverage), 1)


def order_margin_usd(*, side: str, lots: float, price: float, symbol: str | None = None) -> float:
    ensure_mt5()
    mt5 = _mt5()
    sym = symbol or resolve_symbol()
    otype = mt5.ORDER_TYPE_BUY if side == "buy" else mt5.ORDER_TYPE_SELL
    m = mt5.order_calc_margin(otype, sym, float(lots), float(price))
    if m is None:
        return 0.0
    return float(m)


def list_positions(symbol: str | None = None, magic: int | None = None) -> list[dict[str, Any]]:
    rows = _list_positions_raw(symbol)
    if magic is None:
        return rows
    return [p for p in rows if int(p.get("magic", 0)) == int(magic)]


def _list_positions_raw(symbol: str | None = None) -> list[dict[str, Any]]:
    ensure_mt5()
    mt5 = _mt5()
    sym = symbol or resolve_symbol()
    rows = mt5.positions_get(symbol=sym)
    if rows is None:
        return []
    out: list[dict[str, Any]] = []
    for p in rows:
        side = "buy" if int(p.type) == 0 else "sell"
        sl = float(p.sl) if float(p.sl) > 0 else None
        tp = float(p.tp) if float(p.tp) > 0 else None
        out.append(
            {
                "ticket": int(p.ticket),
                "symbol": str(p.symbol),
                "side": side,
                "lots": float(p.volume),
                "open_price": float(p.price_open),
                "sl": sl,
                "tp": tp,
                "profit": float(p.profit),
                "open_time": int(p.time),
                "magic": int(p.magic),
                "comment": str(p.comment or ""),
            }
        )
    return out


def list_orders(symbol: str | None = None, magic: int | None = None) -> list[dict[str, Any]]:
    rows = _list_orders_raw(symbol)
    if magic is None:
        return rows
    return [o for o in rows if int(o.get("magic", 0)) == int(magic)]


def _list_orders_raw(symbol: str | None = None) -> list[dict[str, Any]]:
    ensure_mt5()
    mt5 = _mt5()
    sym = symbol or resolve_symbol()
    rows = mt5.orders_get(symbol=sym)
    if rows is None:
        return []
    out: list[dict[str, Any]] = []
    for o in rows:
        mode, side = _order_mode_side(int(o.type))
        sl = float(o.sl) if float(o.sl) > 0 else None
        tp = float(o.tp) if float(o.tp) > 0 else None
        out.append(
            {
                "ticket": int(o.ticket),
                "symbol": str(o.symbol),
                "side": side,
                "mode": mode,
                "lots": float(o.volume_current),
                "price": float(o.price_open),
                "sl": sl,
                "tp": tp,
                "setup_time": int(o.time_setup),
                "magic": int(o.magic),
                "comment": str(o.comment or ""),
            }
        )
    return out


def total_app_margin_usd(symbol: str | None = None) -> float:
    sym = symbol or resolve_symbol()
    total = 0.0
    for p in list_positions(sym, MAGIC):
        total += order_margin_usd(
            side=str(p["side"]),
            lots=float(p["lots"]),
            price=float(p["open_price"]),
            symbol=sym,
        )
    for o in list_orders(sym, MAGIC):
        total += order_margin_usd(
            side=str(o["side"]),
            lots=float(o["lots"]),
            price=float(o["price"]),
            symbol=sym,
        )
    return total


def foreign_symbol_exposure(symbol: str | None = None) -> dict[str, Any]:
    """非本 APP magic 的持仓/挂单（存在则禁止新开 APP 单）。"""
    sym = symbol or resolve_symbol()
    pos = [p for p in _list_positions_raw(sym) if int(p.get("magic", 0)) != MAGIC]
    ord_ = [o for o in _list_orders_raw(sym) if int(o.get("magic", 0)) != MAGIC]
    return {"positions": pos, "orders": ord_, "count": len(pos) + len(ord_)}


def cancel_order(ticket: int) -> dict[str, Any]:
    ensure_mt5()
    mt5 = _mt5()
    req = {"action": mt5.TRADE_ACTION_REMOVE, "order": int(ticket)}
    res = mt5.order_send(req)
    ok = res is not None and res.retcode == mt5.TRADE_RETCODE_DONE
    return {"ok": ok, "retcode": None if res is None else int(res.retcode)}


def market_order(
    *,
    side: str,
    volume: float,
    sl: float | None = None,
    tp: float | None = None,
    symbol: str | None = None,
    comment: str = "ming_win",
) -> dict[str, Any]:
    ensure_mt5()
    mt5 = _mt5()
    sym = symbol or resolve_symbol()
    if not mt5.symbol_select(sym, True):
        raise RuntimeError(f"symbol_select({sym}) failed")
    vol = round(float(volume), 2)
    if vol < 0.01:
        raise ValueError("volume too small")
    tick = mt5.symbol_info_tick(sym)
    if tick is None:
        raise RuntimeError("no tick")
    if side == "buy":
        otype = mt5.ORDER_TYPE_BUY
        price = float(tick.ask)
    elif side == "sell":
        otype = mt5.ORDER_TYPE_SELL
        price = float(tick.bid)
    else:
        raise ValueError("side must be buy or sell")

    req: dict[str, Any] = {
        "action": mt5.TRADE_ACTION_DEAL,
        "symbol": sym,
        "volume": vol,
        "type": otype,
        "price": price,
        "deviation": _deviation(sym),
        "magic": MAGIC,
        "comment": comment[:31],
        "type_filling": _filling(mt5, sym),
        "type_time": mt5.ORDER_TIME_GTC,
    }
    if sl is not None and sl > 0:
        req["sl"] = float(sl)
    if tp is not None and tp > 0:
        req["tp"] = float(tp)

    t0 = time.perf_counter()
    res = mt5.order_send(req)
    ms = (time.perf_counter() - t0) * 1000.0
    ok = res is not None and res.retcode == mt5.TRADE_RETCODE_DONE
    return {
        "ok": ok,
        "retcode": None if res is None else int(res.retcode),
        "order": None if res is None else int(res.order),
        "deal": None if res is None else int(res.deal),
        "price": None if res is None else float(res.price),
        "comment": None if res is None else str(res.comment),
        "mt5_ms": round(ms, 2),
    }


def limit_order(
    *,
    side: str,
    volume: float,
    price: float,
    sl: float | None = None,
    tp: float | None = None,
    symbol: str | None = None,
    comment: str = "ming_win_lim",
) -> dict[str, Any]:
    ensure_mt5()
    mt5 = _mt5()
    sym = symbol or resolve_symbol()
    if not mt5.symbol_select(sym, True):
        raise RuntimeError(f"symbol_select({sym}) failed")
    vol = round(float(volume), 2)
    px = float(price)
    if side == "buy":
        otype = mt5.ORDER_TYPE_BUY_LIMIT
    elif side == "sell":
        otype = mt5.ORDER_TYPE_SELL_LIMIT
    else:
        raise ValueError("side must be buy or sell")
    req: dict[str, Any] = {
        "action": mt5.TRADE_ACTION_PENDING,
        "symbol": sym,
        "volume": vol,
        "type": otype,
        "price": px,
        "deviation": _deviation(sym),
        "magic": MAGIC,
        "comment": comment[:31],
        "type_filling": _filling(mt5, sym),
        "type_time": mt5.ORDER_TIME_GTC,
    }
    if sl is not None and sl > 0:
        req["sl"] = float(sl)
    if tp is not None and tp > 0:
        req["tp"] = float(tp)
    res = mt5.order_send(req)
    ok = res is not None and res.retcode == mt5.TRADE_RETCODE_DONE
    return {
        "ok": ok,
        "retcode": None if res is None else int(res.retcode),
        "order": None if res is None else int(res.order),
        "price": px,
    }


def pending_order(
    *,
    mode: str,
    side: str,
    volume: float,
    price: float,
    stoplimit: float | None = None,
    sl: float | None = None,
    tp: float | None = None,
    symbol: str | None = None,
) -> dict[str, Any]:
    ensure_mt5()
    mt5 = _mt5()
    sym = symbol or resolve_symbol()
    if not mt5.symbol_select(sym, True):
        raise RuntimeError(f"symbol_select({sym}) failed")
    vol = round(float(volume), 2)
    px = float(price)
    mode = mode.lower()
    if mode == "limit":
        otype = mt5.ORDER_TYPE_BUY_LIMIT if side == "buy" else mt5.ORDER_TYPE_SELL_LIMIT
    elif mode == "stop":
        otype = mt5.ORDER_TYPE_BUY_STOP if side == "buy" else mt5.ORDER_TYPE_SELL_STOP
    elif mode == "stop_limit":
        otype = mt5.ORDER_TYPE_BUY_STOP_LIMIT if side == "buy" else mt5.ORDER_TYPE_SELL_STOP_LIMIT
    else:
        raise ValueError(f"unknown mode {mode}")
    req: dict[str, Any] = {
        "action": mt5.TRADE_ACTION_PENDING,
        "symbol": sym,
        "volume": vol,
        "type": otype,
        "price": px,
        "deviation": _deviation(sym),
        "magic": MAGIC,
        "comment": f"ming_{mode}"[:31],
        "type_filling": _filling(mt5, sym),
        "type_time": mt5.ORDER_TIME_GTC,
    }
    if mode == "stop_limit" and stoplimit is not None:
        req["stoplimit"] = float(stoplimit)
    if sl is not None and sl > 0:
        req["sl"] = float(sl)
    if tp is not None and tp > 0:
        req["tp"] = float(tp)
    res = mt5.order_send(req)
    ok = res is not None and res.retcode == mt5.TRADE_RETCODE_DONE
    return {"ok": ok, "retcode": None if res is None else int(res.retcode), "order": None if res is None else int(res.order)}


def close_position(ticket: int) -> dict[str, Any]:
    ensure_mt5()
    mt5 = _mt5()
    pos = mt5.positions_get(ticket=int(ticket))
    if not pos:
        raise RuntimeError("position not found")
    p = pos[0]
    sym = str(p.symbol)
    side = mt5.ORDER_TYPE_SELL if int(p.type) == 0 else mt5.ORDER_TYPE_BUY
    tick = mt5.symbol_info_tick(sym)
    if tick is None:
        raise RuntimeError("no tick")
    price = float(tick.bid if side == mt5.ORDER_TYPE_SELL else tick.ask)
    req = {
        "action": mt5.TRADE_ACTION_DEAL,
        "symbol": sym,
        "volume": float(p.volume),
        "type": side,
        "position": int(ticket),
        "price": price,
        "deviation": _deviation(sym),
        "magic": MAGIC,
        "comment": "ming_win_close"[:31],
        "type_filling": _filling(mt5, sym),
        "type_time": mt5.ORDER_TIME_GTC,
    }
    position_id = int(getattr(p, "identifier", p.ticket))
    res = mt5.order_send(req)
    ok = res is not None and res.retcode == mt5.TRADE_RETCODE_DONE
    deal_ticket = None
    if ok and res is not None:
        deal_ticket = int(getattr(res, "deal", 0) or 0) or None
    return {
        "ok": ok,
        "retcode": None if res is None else int(res.retcode),
        "deal": deal_ticket,
        "position_id": position_id,
    }


def modify_order_sl_tp(
    ticket: int,
    *,
    price: float | None = None,
    sl: float | None = None,
    tp: float | None = None,
) -> dict[str, Any]:
    ensure_mt5()
    mt5 = _mt5()
    rows = mt5.orders_get(ticket=int(ticket))
    if not rows:
        raise RuntimeError("order not found")
    o = rows[0]
    req: dict[str, Any] = {
        "action": mt5.TRADE_ACTION_MODIFY,
        "order": int(ticket),
        "price": float(price) if price is not None else float(o.price_open),
        "symbol": str(o.symbol),
        "type": int(o.type),
        "volume": float(o.volume_current),
        "sl": float(sl) if sl is not None else float(o.sl),
        "tp": float(tp) if tp is not None else float(o.tp),
    }
    res = mt5.order_send(req)
    ok = res is not None and res.retcode == mt5.TRADE_RETCODE_DONE
    return {"ok": ok, "retcode": None if res is None else int(res.retcode)}


def deal_net_profit(d: Any) -> float:
    return float(d.profit) + float(d.commission) + float(getattr(d, "swap", 0) or 0)


def classify_deal_close_kind(reason: int, *, profit: float | None = None) -> str:
    """平仓归因：止损 / 止盈 / 手动 / 其它（用于连损统计与审计）。"""
    ensure_mt5()
    mt5 = _mt5()
    sl = int(getattr(mt5, "DEAL_REASON_SL", 3))
    tp = int(getattr(mt5, "DEAL_REASON_TP", 4))
    so = int(getattr(mt5, "DEAL_REASON_SO", 5))
    client = int(getattr(mt5, "DEAL_REASON_CLIENT", 0))
    mobile = int(getattr(mt5, "DEAL_REASON_MOBILE", 1))
    web = int(getattr(mt5, "DEAL_REASON_WEB", 2))
    if profit is not None and profit < -0.001 and reason in (tp, sl):
        return "sl"
    if profit is not None and profit > 0.001 and reason in (tp, sl):
        return "tp"
    if reason == sl:
        return "sl"
    if reason == tp:
        return "tp"
    if reason in (so,):
        return "stop_out"
    if reason in (client, mobile, web):
        return "manual"
    return "other"


def _history_date_to():
    """券商 deal 时间常比 PC 快，结束时间必须留足余量否则 history_deals_get 漏单。"""
    from datetime import datetime, timedelta

    return datetime.now() + timedelta(days=2)


def deal_time_bjt_str(deal_unix: int) -> str:
    from datetime import datetime, timezone, timedelta

    bjt = timezone(timedelta(hours=8))
    return datetime.fromtimestamp(int(deal_unix), tz=bjt).strftime("%Y-%m-%d %H:%M:%S")


def fetch_exit_deal(
    *,
    deal_ticket: int | None = None,
    position_id: int | None = None,
    retries: int = 4,
    sleep_s: float = 0.08,
) -> dict[str, Any] | None:
    """读取刚产生的平仓 deal（order_send 后 history 可能略延迟）。"""
    ensure_mt5()
    mt5 = _mt5()
    from datetime import datetime, timedelta
    import time

    def _row(d: Any) -> dict[str, Any] | None:
        if not _is_exit_deal_entry(mt5, int(d.entry)):
            return None
        reason = int(getattr(d, "reason", -1))
        return {
            "ticket": int(d.ticket),
            "position_id": int(d.position_id),
            "profit": deal_net_profit(d),
            "time": int(d.time),
            "magic": int(d.magic),
            "close_kind": classify_deal_close_kind(reason, profit=deal_net_profit(d)),
        }

    for _ in range(max(1, retries)):
        if deal_ticket:
            rows = mt5.history_deals_get(ticket=int(deal_ticket))
            if rows:
                r = _row(rows[0])
                if r:
                    return r
        if position_id:
            rows = mt5.history_deals_get(position=int(position_id))
            if rows:
                outs = [_row(d) for d in rows]
                outs = [x for x in outs if x]
                if outs:
                    return outs[-1]
        date_to = _history_date_to()
        date_from = datetime.now() - timedelta(minutes=30)
        rows = mt5.history_deals_get(date_from, date_to) or []
        if position_id:
            for d in reversed(rows):
                if int(d.position_id) == int(position_id) and _is_exit_deal_entry(mt5, int(d.entry)):
                    r = _row(d)
                    if r:
                        return r
        time.sleep(sleep_s)
    return None


def _symbol_matches_gold(deal_sym: str, resolved: str) -> bool:
    a = str(deal_sym or "").upper()
    b = str(resolved or "").upper()
    if a == b:
        return True
    if a.startswith(b) or b.startswith(a):
        return True
    if "XAU" in a and "XAU" in b:
        return True
    if a.startswith("GOLD") and "XAU" in b:
        return True
    return False


def _deal_row_from_mt5(d: Any, mt5: Any) -> dict[str, Any]:
    reason = int(getattr(d, "reason", -1))
    profit = deal_net_profit(d)
    t = int(d.time)
    return {
        "ticket": int(d.ticket),
        "position_id": int(d.position_id),
        "profit": profit,
        "time": t,
        "time_bjt": deal_time_bjt_str(t),
        "magic": int(d.magic),
        "comment": str(d.comment or ""),
        "reason": reason,
        "close_kind": classify_deal_close_kind(reason, profit=profit),
        "symbol": str(d.symbol),
    }


def _fetch_deal_by_ticket(deal_ticket: int) -> dict[str, Any] | None:
    ensure_mt5()
    mt5 = _mt5()
    rows = mt5.history_deals_get(ticket=int(deal_ticket))
    if not rows:
        return None
    d = rows[0]
    if not _is_exit_deal_entry(mt5, int(d.entry)):
        return None
    return _deal_row_from_mt5(d, mt5)


def _is_exit_deal_entry(mt5: Any, entry: int) -> bool:
    out = int(getattr(mt5, "DEAL_ENTRY_OUT", 1))
    out_by = int(getattr(mt5, "DEAL_ENTRY_OUT_BY", 3))
    return int(entry) in (out, out_by)


def list_exit_deals_since(
    since_unix: int,
    symbol: str | None = None,
    *,
    until_unix: int | None = None,
    magic: int | None = None,
) -> list[dict[str, Any]]:
    """自 since_unix 起、该品种上所有平仓 deal（含非本 APP magic，用于账户级核对）。"""
    ensure_mt5()
    mt5 = _mt5()
    sym = symbol or resolve_symbol()
    from datetime import datetime, timedelta

    # MT5 终端历史与 PC 本地时间对齐，使用 naive local datetime。
    # Python 包无 MQL5 的 history_select，直接用 history_deals_get 按时间窗拉取。
    date_from = datetime.fromtimestamp(int(since_unix)) - timedelta(minutes=30)
    date_to = _history_date_to()
    rows = list(mt5.history_deals_get(date_from, date_to) or [])
    wide_from = datetime.now() - timedelta(days=7)
    rows_wide = list(mt5.history_deals_get(wide_from, date_to) or [])
    by_ticket: dict[int, Any] = {}
    for d in rows_wide:
        by_ticket[int(d.ticket)] = d
    for d in rows:
        by_ticket[int(d.ticket)] = d
    rows = list(by_ticket.values())
    if rows is None:
        return []
    out: list[dict[str, Any]] = []
    for d in rows:
        if not _symbol_matches_gold(str(d.symbol), sym):
            continue
        if not _is_exit_deal_entry(mt5, int(d.entry)):
            continue
        if magic is not None and int(d.magic) != int(magic):
            continue
        t = int(d.time)
        if t < int(since_unix) - 3600:
            continue
        if until_unix is not None and t > int(until_unix) + 86400:
            continue
        out.append(_deal_row_from_mt5(d, mt5))
    out.sort(key=lambda x: x["time"])
    return out


def supplement_exit_deals(deals: list[dict[str, Any]], extra_tickets: list[int], since_unix: int, resolved_sym: str) -> list[dict[str, Any]]:
    """补拉按 ticket 已入账但时间窗批量接口漏掉的平仓 deal。"""
    have = {int(d["ticket"]) for d in deals}
    for t in extra_tickets:
        ti = int(t)
        if ti in have:
            continue
        row = _fetch_deal_by_ticket(ti)
        if not row:
            continue
        if int(row["time"]) < int(since_unix) - 3600:
            continue
        sym = str(row.get("symbol") or "")
        if sym and not _symbol_matches_gold(sym, resolved_sym):
            continue
        deals.append(row)
        have.add(ti)
    deals.sort(key=lambda x: int(x["time"]))
    return deals


def modify_sl_tp(ticket: int, *, sl: float | None = None, tp: float | None = None) -> dict[str, Any]:
    ensure_mt5()
    mt5 = _mt5()
    pos = mt5.positions_get(ticket=int(ticket))
    if not pos:
        raise RuntimeError("position not found")
    p = pos[0]
    req: dict[str, Any] = {
        "action": mt5.TRADE_ACTION_SLTP,
        "position": int(ticket),
        "symbol": str(p.symbol),
        "sl": float(sl) if sl is not None else float(p.sl),
        "tp": float(tp) if tp is not None else float(p.tp),
    }
    res = mt5.order_send(req)
    ok = res is not None and res.retcode == mt5.TRADE_RETCODE_DONE
    return {"ok": ok, "retcode": None if res is None else int(res.retcode)}
