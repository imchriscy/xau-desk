"""北京时间日风控 · 06:00 至次日 05:00 为同一交易窗；按 MT5 登录号隔离。"""



from __future__ import annotations



import json

from dataclasses import asdict, dataclass

from datetime import datetime, timedelta, timezone

from pathlib import Path

from typing import Any



BJT = timezone(timedelta(hours=8))

STATE_PATH = Path(__file__).resolve().parent / "risk_state.json"





@dataclass

class RiskConfig:

    daily_enabled: bool = False

    per_trade_loss_cap_usd: float | None = None

    per_trade_loss_cap_pct: float | None = None

    daily_loss_cap_usd: float | None = None

    daily_loss_cap_pct: float | None = None

    baseline_equity: float | None = None

    baseline_confirmed_at: str | None = None

    # 绑定 MT5 登录号，防止旧版单文件或误迁移串账户
    bound_login: int | None = None

    streak_enabled: bool = True

    streak_tier1_losses: int = 3

    streak_tier1_pause_minutes: int = 30

    streak_tier2_losses: int = 5

    streak_tier2_pause_minutes: int = 180

    require_stop_loss: bool = True

    # 风控演算本金（如 12 万盘按 1000 计）；为空则用 MT5 净值
    virtual_equity_usd: float | None = None

    # 锁定基准时 MT5 实际净值，用于日损 USD 累计
    equity_anchor: float | None = None

    # 最大保证金 ≈ virtual × factor ÷ leverage（例 100×200÷1000=20U）
    margin_cap_factor: float = 200.0

    max_combined_slots: int = 6

    app_magic_only: bool = True





@dataclass

class RiskRuntime:

    session_key: str = ""

    halted_until_bjt: str | None = None

    halt_reason: str | None = None

    last_equity: float | None = None

    params_locked_session: str | None = None

    halt_flatten_token: str | None = None

    consecutive_losses: int = 0

    streak_tier3_armed: bool = False

    streak_halt_trigger_deal: int | None = None





def _load_root() -> dict[str, Any]:

    if not STATE_PATH.is_file():

        return {"accounts": {}}

    data = json.loads(STATE_PATH.read_text(encoding="utf-8"))

    if "accounts" not in data:

        legacy_cfg = data.get("config") or {}

        legacy_rt = data.get("runtime") or {}

        # 仅归档，任何 MT5 login 不得读取此桶
        data = {"accounts": {LEGACY_ARCHIVE_KEY: {"config": legacy_cfg, "runtime": legacy_rt}}}

        _save_root(data)

    # 旧版误用 "0" 桶：迁到归档，避免 login=0 或误读
    accounts = data.get("accounts") or {}

    if "0" in accounts and LEGACY_ARCHIVE_KEY not in accounts:

        accounts[LEGACY_ARCHIVE_KEY] = accounts.pop("0")

        data["accounts"] = accounts

        _save_root(data)

    for stale in ("config", "runtime"):

        if stale in data:

            data.pop(stale, None)

            _save_root(data)

    return data





def _save_root(data: dict[str, Any]) -> None:

    STATE_PATH.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")





LEGACY_ARCHIVE_KEY = "_legacy_unassigned"


def _acct_key(login: int) -> str:

    return str(int(login))


def _is_reserved_account_key(key: str) -> bool:

    return key == LEGACY_ARCHIVE_KEY or key == "0"





def _empty_blob() -> dict[str, Any]:

    return {"config": {}, "runtime": {}}


def _blob(login: int) -> dict[str, Any]:

    data = _load_root()

    key = _acct_key(login)

    accounts = data.setdefault("accounts", {})

    if key not in accounts:

        accounts[key] = _empty_blob()

        _save_root(data)

    return accounts[key]


def _config_matches_login(raw: dict[str, Any], login: int) -> bool:

    bound = raw.get("bound_login")

    if bound is None:

        return True

    try:

        return int(bound) == int(login)

    except (TypeError, ValueError):

        return False


def _reset_account_blob(login: int) -> None:

    data = _load_root()

    data.setdefault("accounts", {})[_acct_key(login)] = _empty_blob()

    _save_root(data)


def repair_if_baseline_mismatch(login: int, equity: float) -> bool:

    """仅 bound_login 与当前 MT5 登录不一致时清空；触发中的暂停不因净值变化而解除。"""

    b = _blob(login)

    raw_cfg = b.get("config") or {}

    if not raw_cfg:

        return False

    if not _config_matches_login(raw_cfg, login):

        _reset_account_blob(login)

        return True

    return False





def bjt_now() -> datetime:

    return datetime.now(BJT)





def session_key_for(ts: datetime | None = None) -> str:

    ts = ts or bjt_now()

    if ts.hour >= 6:

        d = ts.date()

    else:

        d = (ts - timedelta(days=1)).date()

    return d.isoformat()





def session_window_bjt(session_key: str) -> tuple[datetime, datetime]:

    from datetime import date as date_cls



    start_d = date_cls.fromisoformat(session_key)

    start = datetime(start_d.year, start_d.month, start_d.day, 6, 0, 0, tzinfo=BJT)

    end = start + timedelta(hours=23)

    return start, end





def next_session_start_bjt(from_ts: datetime | None = None) -> datetime:

    ts = from_ts or bjt_now()

    sk = session_key_for(ts)

    start, _ = session_window_bjt(sk)

    if ts >= start:

        return start + timedelta(days=1)

    return start





def get_config(login: int) -> RiskConfig:

    raw = _blob(login).get("config") or {}

    if raw and not _config_matches_login(raw, login):

        _reset_account_blob(login)

        raw = {}

    return RiskConfig(

        daily_enabled=bool(raw.get("daily_enabled")),

        per_trade_loss_cap_usd=raw.get("per_trade_loss_cap_usd"),

        per_trade_loss_cap_pct=raw.get("per_trade_loss_cap_pct"),

        daily_loss_cap_usd=raw.get("daily_loss_cap_usd"),

        daily_loss_cap_pct=raw.get("daily_loss_cap_pct"),

        baseline_equity=raw.get("baseline_equity"),

        baseline_confirmed_at=raw.get("baseline_confirmed_at"),

        bound_login=int(raw["bound_login"]) if raw.get("bound_login") is not None else None,

        streak_enabled=bool(raw.get("streak_enabled", True)),

        streak_tier1_losses=int(raw.get("streak_tier1_losses") or 3),

        streak_tier1_pause_minutes=int(raw.get("streak_tier1_pause_minutes") or 30),

        streak_tier2_losses=int(raw.get("streak_tier2_losses") or 5),

        streak_tier2_pause_minutes=int(raw.get("streak_tier2_pause_minutes") or 180),

        require_stop_loss=bool(raw.get("require_stop_loss", True)),

        virtual_equity_usd=raw.get("virtual_equity_usd"),

        equity_anchor=raw.get("equity_anchor"),

        margin_cap_factor=float(raw.get("margin_cap_factor") or 200.0),

        max_combined_slots=int(raw.get("max_combined_slots") or 6),

        app_magic_only=bool(raw.get("app_magic_only", True)),

    )





def get_runtime(login: int) -> RiskRuntime:

    raw = _blob(login).get("runtime") or {}

    return RiskRuntime(

        session_key=str(raw.get("session_key") or ""),

        halted_until_bjt=raw.get("halted_until_bjt"),

        halt_reason=raw.get("halt_reason"),

        last_equity=raw.get("last_equity"),

        params_locked_session=raw.get("params_locked_session"),

        halt_flatten_token=raw.get("halt_flatten_token"),

        consecutive_losses=int(raw.get("consecutive_losses") or 0),

        streak_tier3_armed=bool(raw.get("streak_tier3_armed")),

        streak_halt_trigger_deal=int(raw["streak_halt_trigger_deal"])
        if raw.get("streak_halt_trigger_deal") not in (None, "")
        else None,

    )





def save_config(cfg: RiskConfig, login: int) -> None:

    cfg.bound_login = int(login)

    b = _blob(login)

    b["config"] = asdict(cfg)

    data = _load_root()

    data["accounts"][_acct_key(login)] = b

    _save_root(data)





def save_runtime(rt: RiskRuntime, login: int) -> None:

    b = _blob(login)

    b["runtime"] = asdict(rt)

    data = _load_root()

    data["accounts"][_acct_key(login)] = b

    _save_root(data)





def params_locked_for_session(login: int, now: datetime | None = None) -> bool:

    rt = get_runtime(login)

    sk = session_key_for(now)

    return bool(rt.params_locked_session and rt.params_locked_session == sk)





def apply_save_config(cfg: RiskConfig, login: int, *, equity: float | None = None) -> RiskConfig:

    halted, reason = is_trading_halted(login)

    if halted:

        raise PermissionError(f"风控暂停中不可修改参数：{reason or '已锁定'}")

    if params_locked_for_session(login):

        raise PermissionError("本交易窗风控参数已锁定，次交易日 06:00（北京）后可修改")

    t1, t1m, t2, t2m = streak_tiers(cfg)
    cfg.streak_tier1_losses = t1
    cfg.streak_tier1_pause_minutes = t1m
    cfg.streak_tier2_losses = t2
    cfg.streak_tier2_pause_minutes = t2m

    save_config(cfg, login)

    from risk_event_log import log_risk_event

    log_risk_event(login, "config_saved", detail="风控参数已保存", payload=asdict(cfg))

    if cfg.daily_enabled:

        rt = get_runtime(login)

        rt.params_locked_session = session_key_for()

        save_runtime(rt, login)

        log_risk_event(login, "params_locked_session", detail=f"本窗锁定 {rt.params_locked_session}")

        if cfg.baseline_equity is None and equity is not None and equity > 0:

            return confirm_baseline(float(equity), login, allow_while_locked=True)

    return cfg





def confirm_baseline(equity: float, login: int, *, allow_while_locked: bool = False) -> RiskConfig:

    cfg = get_config(login)

    halted, halt_msg = is_trading_halted(login)

    if halted:

        raise PermissionError(f"风控暂停中不可改基准净值：{halt_msg or '已锁定'}")

    if params_locked_for_session(login) and not allow_while_locked:

        if cfg.baseline_equity is None:

            allow_while_locked = True

        else:

            raise PermissionError("本交易窗基准已锁定，次交易日 06:00 后可修改")

    rt = get_runtime(login)

    prev_until = rt.halted_until_bjt

    prev_reason = rt.halt_reason

    prev_flatten = rt.halt_flatten_token

    if cfg.virtual_equity_usd is not None and float(cfg.virtual_equity_usd) > 0:

        cfg.baseline_equity = float(cfg.virtual_equity_usd)

    else:

        cfg.baseline_equity = float(equity)

    cfg.equity_anchor = float(equity)

    cfg.baseline_confirmed_at = bjt_now().isoformat()

    save_config(cfg, login)

    from risk_event_log import log_risk_event

    log_risk_event(

        login,

        "baseline_locked",

        detail=f"基准 {cfg.baseline_equity:.2f} · 锚定净值 {cfg.equity_anchor:.2f}",

        payload={"virtual_equity_usd": cfg.virtual_equity_usd},

    )

    rt.session_key = session_key_for()

    rt.last_equity = float(equity)

    if prev_until:

        try:

            until = datetime.fromisoformat(prev_until)

            if bjt_now() < until:

                rt.halted_until_bjt = prev_until

                rt.halt_reason = prev_reason

                rt.halt_flatten_token = prev_flatten

        except ValueError:

            pass

    save_runtime(rt, login)

    return cfg





def xau_loss_usd(entry: float, sl: float | None, lots: float, side: str) -> float:

    if sl is None:

        return 0.0

    dist = abs(entry - sl)

    if side == "buy" and sl >= entry:

        return 0.0

    if side == "sell" and sl <= entry:

        return 0.0

    return dist * 100.0 * lots





def session_drawdown_usd(anchor_equity: float, current_equity: float) -> float:

    return max(0.0, float(anchor_equity) - float(current_equity))


def risk_notional_equity(cfg: RiskConfig, actual_equity: float) -> float:

    if cfg.virtual_equity_usd is not None and float(cfg.virtual_equity_usd) > 0:

        return float(cfg.virtual_equity_usd)

    return float(actual_equity)


def max_margin_budget_usd(cfg: RiskConfig, leverage: int, actual_equity: float) -> float:

    eq = risk_notional_equity(cfg, actual_equity)

    lev = max(int(leverage), 1)

    factor = float(cfg.margin_cap_factor or 200.0)

    return eq * factor / lev





def _flatten_all_mt5() -> dict[str, Any]:

    from mt5_trading import MAGIC, cancel_order, close_position, list_orders, list_positions



    cancelled: list[int] = []

    closed: list[int] = []

    for o in list_orders(magic=MAGIC):

        r = cancel_order(o["ticket"])

        if r.get("ok"):

            cancelled.append(int(o["ticket"]))

    for p in list_positions(magic=MAGIC):

        r = close_position(int(p["ticket"]))

        if r.get("ok"):

            closed.append(int(p["ticket"]))

    return {"cancelled": cancelled, "closed": closed}





def _parse_until(iso: str | None) -> datetime | None:

    if not iso:

        return None

    try:

        return datetime.fromisoformat(iso)

    except ValueError:

        return None


def _extend_halt_until(login: int, until: datetime, reason: str, *, event: str = "trading_halt") -> None:

    rt = get_runtime(login)

    cur = _parse_until(rt.halted_until_bjt)

    extended = cur is None or until > cur

    if extended:

        rt.halted_until_bjt = until.isoformat()

        rt.halt_reason = reason

    elif cur is not None and until <= cur and not rt.halt_reason:

        rt.halt_reason = reason

    save_runtime(rt, login)

    if extended or event.startswith("streak"):

        from risk_event_log import log_risk_event

        log_risk_event(

            login,

            event,

            detail=reason,

            payload={"until_bjt": rt.halted_until_bjt},

        )


def is_trading_halted(login: int, now: datetime | None = None) -> tuple[bool, str | None]:

    now = now or bjt_now()

    rt = get_runtime(login)

    sk = session_key_for(now)

    if rt.session_key != sk:

        rt.session_key = sk

        if rt.params_locked_session and rt.params_locked_session != sk:

            rt.params_locked_session = None

        until = _parse_until(rt.halted_until_bjt)

        if until is not None and now >= until:

            rt.halted_until_bjt = None

            rt.halt_reason = None

            rt.halt_flatten_token = None

        save_runtime(rt, login)

    until = _parse_until(rt.halted_until_bjt)

    if until is not None and now < until:

        return True, rt.halt_reason or "交易已暂停"

    if until is not None and now >= until:

        was_streak = "连续止损" in (rt.halt_reason or "")

        rt.halted_until_bjt = None

        rt.halt_reason = None

        if was_streak:

            rt.consecutive_losses = 0

            rt.streak_tier3_armed = False

            rt.streak_halt_trigger_deal = None

            from risk_event_log import log_risk_event

            log_risk_event(login, "streak_cooldown_done", detail="连续止损冷却结束，计数已清零")

        save_runtime(rt, login)

    return False, None


STREAK_LOSS_EPS = 0.01


def streak_tiers(cfg: RiskConfig) -> tuple[int, int, int, int]:
    t1 = max(1, min(20, int(cfg.streak_tier1_losses or 3)))
    t1m = max(1, min(7 * 24 * 60, int(cfg.streak_tier1_pause_minutes or 30)))
    t2 = max(t1 + 1, min(30, int(cfg.streak_tier2_losses or 5)))
    t2m = max(1, min(7 * 24 * 60, int(cfg.streak_tier2_pause_minutes or 180)))
    return t1, t1m, t2, t2m


def _fmt_streak_pause(minutes: int) -> str:
    if minutes >= 60 and minutes % 60 == 0:
        h = minutes // 60
        return f"{h} 小时"
    return f"{minutes} 分钟"


def _replay_streak_from_deals(
    deals: list[dict[str, Any]],
    *,
    tier1: int = 3,
    tier2: int = 5,
) -> tuple[int, bool]:
    """按时间顺序重放本窗平仓，得到当前连损计数（与逐笔 _apply 规则一致，含高档清零）。"""

    cl = 0
    tier3 = False
    for d in deals:
        p = float(d["profit"])
        if p < -STREAK_LOSS_EPS:
            cl += 1
            if cl >= tier2:
                cl = 0
                tier3 = False
            elif cl >= tier1:
                tier3 = True
        elif p > STREAK_LOSS_EPS:
            cl = 0
            tier3 = False
    return cl, tier3


def _deal_time_bjt(deal: dict[str, Any]) -> datetime:
    return datetime.fromtimestamp(int(deal["time"]), tz=BJT)


def _streak_pause_until(deal_ts: datetime, duration: timedelta, now: datetime) -> datetime:
    """暂停时长固定为 duration；仅首次写入 runtime，之后不再随轮询改变。"""

    if deal_ts <= now:
        return deal_ts + duration
    return now + duration


def _active_streak_halt_until(
    deals: list[dict[str, Any]],
    now: datetime,
    *,
    tier1: int,
    tier1_minutes: int,
    tier2: int,
    tier2_minutes: int,
) -> tuple[datetime | None, str | None, int | None]:
    """根据本窗成交重放，计算当前是否仍处于连损暂停窗口（及触发该档的 deal ticket）。"""

    best_until: datetime | None = None
    best_reason: str | None = None
    best_trigger: int | None = None
    cl = 0
    tier3_fired = False
    for d in sorted(deals, key=lambda x: int(x["time"])):
        t = _deal_time_bjt(d)
        ticket = int(d["ticket"])
        p = float(d["profit"])
        if p < -STREAK_LOSS_EPS:
            cl += 1
            if cl >= tier2:
                u = _streak_pause_until(t, timedelta(minutes=tier2_minutes), now)
                if best_until is None or u > best_until:
                    best_until = u
                    best_reason = f"连续止损 {tier2} 笔 · 暂停 {_fmt_streak_pause(tier2_minutes)}"
                    best_trigger = ticket
                cl = 0
                tier3_fired = False
            elif cl >= tier1 and not tier3_fired:
                u = _streak_pause_until(t, timedelta(minutes=tier1_minutes), now)
                if best_until is None or u > best_until:
                    best_until = u
                    best_reason = f"连续止损 {tier1} 笔 · 暂停 {_fmt_streak_pause(tier1_minutes)}"
                    best_trigger = ticket
                tier3_fired = True
        elif p > STREAK_LOSS_EPS:
            cl = 0
            tier3_fired = False
    if best_until is not None and now < best_until:
        return best_until, best_reason, best_trigger
    return None, None, None


def _enforce_streak_halt_from_deals(login: int, deals: list[dict[str, Any]], now: datetime) -> None:
    """写入连损暂停；解锁时刻只写一次，轮询/重登不得把倒计时重置为满 3 小时。"""

    rt = get_runtime(login)
    cur = _parse_until(rt.halted_until_bjt)
    if cur is not None and now < cur and "连续止损" in (rt.halt_reason or ""):
        return

    cfg = get_config(login)
    t1, t1m, t2, t2m = streak_tiers(cfg)
    until, reason, trigger = _active_streak_halt_until(
        deals, now, tier1=t1, tier1_minutes=t1m, tier2=t2, tier2_minutes=t2m
    )
    if until is None or not reason or now >= until:
        return

    if cur is not None and "连续止损" not in (rt.halt_reason or "") and cur > until:
        return

    rt.halted_until_bjt = until.isoformat()
    rt.halt_reason = reason
    if trigger is not None:
        rt.streak_halt_trigger_deal = int(trigger)
    save_runtime(rt, login)


def _log_streak_loss(
    login: int,
    profit: float,
    close_kind: str,
    deal_ticket: int,
    consecutive: int,
    *,
    deal_time_bjt: str | None = None,
) -> None:

    from risk_event_log import log_risk_event

    kind_label = {

        "sl": "止损",

        "manual": "手动平仓",

        "tp": "止盈",

        "stop_out": "强平",

    }.get(close_kind, "平仓")

    when = f" · 成交 {deal_time_bjt} BJT" if deal_time_bjt else ""

    log_risk_event(

        login,

        "streak_loss_counted",

        detail=f"{kind_label} 亏损 {profit:.2f} USD · 连续亏损 {consecutive} 笔{when}",

        payload={
            "deal_ticket": deal_ticket,
            "close_kind": close_kind,
            "consecutive_losses": consecutive,
            "deal_time_bjt": deal_time_bjt,
        },

    )


BULK_NEW_DEALS_MAX = 8


def _audit_and_halts_for_new_rows(
    login: int,
    rt: RiskRuntime,
    *,
    prior_deals: list[dict[str, Any]],
    new_rows: list[dict[str, Any]],
    now: datetime,
) -> list[str]:
    """仅少量新 deal 时写审计并触发暂停（重建/批量补历史 >8 笔则跳过）。"""

    if len(new_rows) > BULK_NEW_DEALS_MAX:
        return []

    cfg = get_config(login)
    t1, _t1m, t2, _t2m = streak_tiers(cfg)

    triggered: list[str] = []
    base = list(prior_deals)
    for d in sorted(new_rows, key=lambda x: int(x["time"])):
        cl_before, tier3_before = _replay_streak_from_deals(base, tier1=t1, tier2=t2)
        base.append(d)
        cl_after, _tier3_after = _replay_streak_from_deals(base, tier1=t1, tier2=t2)
        p = float(d["profit"])
        close_kind = str(d.get("close_kind") or "other")
        ticket = int(d["ticket"])
        if p < -STREAK_LOSS_EPS:
            _log_streak_loss(
                login,
                p,
                close_kind,
                ticket,
                cl_after,
                deal_time_bjt=str(d.get("time_bjt") or ""),
            )
        rt.consecutive_losses = cl_before
        rt.streak_tier3_armed = tier3_before
        if cl_after >= t1 and cl_before < t1:
            rt.consecutive_losses = cl_after
            rt.streak_tier3_armed = False
            triggered.extend(_maybe_trigger_streak_halts(login, rt, now))
        elif cl_before == t2 - 1 and cl_after == 0 and p < -STREAK_LOSS_EPS:
            rt.consecutive_losses = t2
            rt.streak_tier3_armed = False
            triggered.extend(_maybe_trigger_streak_halts(login, rt, now))
    return triggered


def _maybe_trigger_streak_halts(login: int, rt: RiskRuntime, now: datetime) -> list[str]:

    cfg = get_config(login)
    if not cfg.streak_enabled:
        return []

    t1, t1m, t2, t2m = streak_tiers(cfg)
    triggered: list[str] = []

    if rt.consecutive_losses >= t1 and not rt.streak_tier3_armed:

        rt.streak_tier3_armed = True

        until = now + timedelta(minutes=t1m)

        _extend_halt_until(
            login,
            until,
            f"连续止损 {rt.consecutive_losses} 笔 · 暂停 {_fmt_streak_pause(t1m)}",
            event="streak_pause_t1",
        )

        triggered.append("streak_t1")

    if rt.consecutive_losses >= t2:

        until = now + timedelta(minutes=t2m)

        _extend_halt_until(
            login,
            until,
            f"连续止损 {rt.consecutive_losses} 笔 · 暂停 {_fmt_streak_pause(t2m)}",
            event="streak_pause_t2",
        )

        rt.consecutive_losses = 0

        rt.streak_tier3_armed = False

        triggered.append("streak_t2")

    return triggered


def ingest_streak_close_deal(
    login: int,
    *,
    deal_ticket: int,
    profit: float,
    close_kind: str = "manual",
) -> dict[str, Any]:
    """平仓 deal 即时入账（不依赖 history 轮询），已处理 ticket 自动跳过。"""

    from trade_journal import append_event, mark_deals_seen, seen_deals

    if int(deal_ticket) in seen_deals(login):

        rt = get_runtime(login)

        return {"skipped": True, "consecutive_losses": rt.consecutive_losses, "synced": 0}

    rt = get_runtime(login)

    append_event(

        login,

        kind="close",

        profit_usd=profit,

        deal_ticket=int(deal_ticket),

        source="ingest",

        note=f"ingest · {close_kind}",

    )

    mark_deals_seen(login, [int(deal_ticket)])

    out = sync_consecutive_losses(login)

    out["source"] = "ingest"

    return out


def resync_streak_losses(login: int, *, rebuild: bool = False) -> dict[str, Any]:

    """重新从 MT5 拉取本窗平仓并重建连损（rebuild 时清空已处理 deal 缓存）。"""

    from trade_journal import clear_seen_deals

    if rebuild:

        clear_seen_deals(login)

        rt = get_runtime(login)

        rt.consecutive_losses = 0

        rt.streak_tier3_armed = False

        rt.streak_halt_trigger_deal = None

        save_runtime(rt, login)

    return sync_consecutive_losses(login, live_events=not rebuild)


def sync_consecutive_losses(login: int, *, live_events: bool = True) -> dict[str, Any]:

    """从 MT5 平仓 deal + 本地 journal 同步连续亏损计数（含手动平仓亏损，视同连损）。"""

    cfg = get_config(login)

    cfg.streak_enabled = True

    from mt5_trading import list_exit_deals_since, resolve_symbol

    from trade_journal import append_event, journal_deal_tickets, journal_has_deal, mark_deals_seen, seen_deals

    rt = get_runtime(login)

    sk = session_key_for()

    start, end = session_window_bjt(sk)

    since = int(start.timestamp())
    until = int(end.timestamp())

    known = seen_deals(login)

    try:

        sym = resolve_symbol()

        # 连损：该品种全部平仓盈亏均计入（含 MT5 手动平仓；下单仍仅允许 APP magic）
        from mt5_trading import supplement_exit_deals

        deals = list_exit_deals_since(since, sym, until_unix=until)
        extra_tickets = list(known | journal_deal_tickets(login))
        deals = supplement_exit_deals(deals, extra_tickets, since, sym)
        deals = [d for d in deals if int(d["time"]) <= until + 86400]

    except Exception as ex:

        return {

            "consecutive_losses": rt.consecutive_losses,

            "synced": 0,

            "error": "mt5_history",

            "error_detail": str(ex)[:200],

        }

    new_rows = [d for d in deals if int(d["ticket"]) not in known]

    known_deals = [d for d in deals if int(d["ticket"]) in known]

    t1, _, t2, _ = streak_tiers(cfg)

    before_cl, before_tier3 = _replay_streak_from_deals(known_deals, tier1=t1, tier2=t2)

    now = bjt_now()

    for d in new_rows:

        profit = float(d["profit"])
        close_kind = str(d.get("close_kind") or "other")

        ticket = int(d["ticket"])
        if not journal_has_deal(login, ticket):
            append_event(

                login,

                kind="close",

                profit_usd=profit,

                deal_ticket=ticket,

                source="mt5",

                note=f"magic={d.get('magic')} · {close_kind}",

            )

    if new_rows:

        mark_deals_seen(login, [int(d["ticket"]) for d in new_rows])

    replay_cl, replay_tier3 = _replay_streak_from_deals(deals, tier1=t1, tier2=t2)

    rt = get_runtime(login)

    triggered: list[str] = []

    if new_rows and live_events:

        triggered = _audit_and_halts_for_new_rows(

            login,

            rt,

            prior_deals=known_deals,

            new_rows=new_rows,

            now=now,

        )

    rt.consecutive_losses = replay_cl

    rt.streak_tier3_armed = replay_tier3

    save_runtime(rt, login)

    _enforce_streak_halt_from_deals(login, deals, now)

    rt = get_runtime(login)

    newest_ticket = int(deals[-1]["ticket"]) if deals else None

    return {

        "consecutive_losses": rt.consecutive_losses,

        "synced": len(new_rows),

        "deals_in_window": len(deals),

        "newest_deal_ticket": newest_ticket,

        "triggered": triggered,

        "hint": "无新 deal" if not new_rows and deals else (

            "MT5 历史为空，请确认终端已登录且账户有成交历史" if not deals else None

        ),

    }


def suggest_caps_for_equity(equity: float) -> dict[str, float]:

    """小资金默认建议：≤500 USD 单笔 2%、日 25%；更大账户日 10%。"""

    eq = max(float(equity), 1.0)

    if eq <= 500:

        return {"per_trade_loss_cap_pct": 2.0, "daily_loss_cap_pct": 25.0}

    if eq <= 2000:

        return {"per_trade_loss_cap_pct": 1.5, "daily_loss_cap_pct": 20.0}

    return {"per_trade_loss_cap_pct": 1.0, "daily_loss_cap_pct": 10.0}





def trigger_daily_halt(reason: str, login: int) -> dict[str, Any]:

    rt = get_runtime(login)

    until = next_session_start_bjt()

    until_iso = until.isoformat()

    _extend_halt_until(login, until, reason, event="daily_halt")

    rt = get_runtime(login)

    until_iso = rt.halted_until_bjt or until.isoformat()

    flatten_result: dict[str, Any] = {"cancelled": [], "closed": []}

    if rt.halt_flatten_token != until_iso:

        flatten_result = _flatten_all_mt5()

        rt.halt_flatten_token = until_iso

    save_runtime(rt, login)

    flatten_result["halted_until_bjt"] = until_iso

    return flatten_result





def assert_trading_allowed(login: int) -> None:

    halted, reason = is_trading_halted(login)

    if halted:

        raise PermissionError(reason or "日风控暂停交易中")





def update_equity(equity: float, login: int) -> dict[str, Any]:

    repair_if_baseline_mismatch(login, equity)

    cfg = get_config(login)

    rt = get_runtime(login)

    sk = session_key_for()

    if rt.session_key != sk:

        rt.session_key = sk

        if cfg.daily_enabled and cfg.baseline_equity is not None:

            cfg.equity_anchor = equity

            save_config(cfg, login)

    rt.last_equity = equity

    save_runtime(rt, login)



    halted, msg = is_trading_halted(login)

    out: dict[str, Any] = {"equity": equity, "session_key": sk, "halted": halted, "halt_reason": msg}

    if not cfg.daily_enabled or cfg.baseline_equity is None:

        return out



    anchor = cfg.equity_anchor if cfg.equity_anchor is not None else equity

    dd = session_drawdown_usd(anchor, equity)

    out["session_drawdown_usd"] = dd

    cap_usd = cfg.daily_loss_cap_usd

    cap_pct = cfg.daily_loss_cap_pct

    limit = None

    if cap_usd is not None:

        limit = cap_usd

    if cap_pct is not None and cfg.baseline_equity:

        limit = min(limit, cfg.baseline_equity * cap_pct / 100.0) if limit is not None else cfg.baseline_equity * cap_pct / 100.0

    out["daily_loss_limit_usd"] = limit

    if limit is not None and dd >= limit and not halted:

        trigger_daily_halt(f"当日累计亏损已达上限 {limit:.2f} USD", login)

        from risk_event_log import log_risk_event

        log_risk_event(

            login,

            "daily_loss_cap",

            detail=f"日损 {dd:.2f} ≥ 上限 {limit:.2f}",

            payload={"session_drawdown_usd": dd, "limit_usd": limit},

        )

        out["halted"] = True

        out["halt_reason"] = "当日累计止损触顶"

    return out





def assert_exposure_allowed(

    cfg: RiskConfig,

    *,

    side: str,

    lots: float,

    entry: float,

    equity: float,

) -> dict[str, Any]:

    from mt5_trading import (

        MAGIC,

        account_leverage,

        foreign_symbol_exposure,

        list_orders,

        list_positions,

        order_margin_usd,

        resolve_symbol,

        total_app_margin_usd,

    )

    sym = resolve_symbol()

    if cfg.app_magic_only:

        foreign = foreign_symbol_exposure(sym)

        if foreign["count"] > 0:

            raise PermissionError(

                f"存在 {foreign['count']} 笔非 APP 持仓/挂单（magic≠{MAGIC}），请先处理后再用本终端下单",

            )

    max_slots = int(cfg.max_combined_slots or 6)

    app_pos = list_positions(sym, MAGIC)

    app_ord = list_orders(sym, MAGIC)

    used_slots = len(app_pos) + len(app_ord)

    if used_slots + 1 > max_slots:

        raise PermissionError(f"持仓+挂单已达 {used_slots}/{max_slots}，无法再开新单")

    lev = account_leverage()

    budget = max_margin_budget_usd(cfg, lev, equity)

    used_margin = total_app_margin_usd(sym)

    new_margin = order_margin_usd(side=side, lots=lots, price=entry, symbol=sym)

    if used_margin + new_margin > budget + 1e-6:

        raise PermissionError(

            f"保证金超限：已用 {used_margin:.2f} + 本单 {new_margin:.2f} > 上限 {budget:.2f} USD"

            f"（演算本金 {risk_notional_equity(cfg, equity):.0f} × {cfg.margin_cap_factor}/杠杆{lev}）",

        )

    return {

        "app_open_slots": used_slots,

        "max_combined_slots": max_slots,

        "margin_used_usd": used_margin,

        "margin_new_usd": new_margin,

        "margin_budget_usd": budget,

        "leverage": lev,

    }


def check_order_allowed(

    *,

    login: int,

    side: str,

    lots: float,

    entry: float,

    sl: float | None,

    equity: float,

) -> None:

    assert_trading_allowed(login)



    cfg = get_config(login)

    cfg.streak_enabled = True

    if cfg.require_stop_loss or cfg.daily_enabled:

        if sl is None or float(sl) <= 0:

            raise PermissionError("必须设置止损（SL）后才允许下单")

    assert_exposure_allowed(cfg, side=side, lots=lots, entry=entry, equity=equity)

    loss = xau_loss_usd(entry, sl, lots, side)

    caps: list[float] = []

    if cfg.per_trade_loss_cap_usd is not None:

        caps.append(float(cfg.per_trade_loss_cap_usd))

    if cfg.per_trade_loss_cap_pct is not None:

        caps.append(risk_notional_equity(cfg, equity) * float(cfg.per_trade_loss_cap_pct) / 100.0)

    if caps and loss > min(caps) + 1e-6:

        raise PermissionError(f"单笔止损金额 {loss:.2f} USD 超过上限 {min(caps):.2f} USD")

    if cfg.daily_enabled and cfg.baseline_equity is None:

        raise PermissionError("请先在风控界面确认基准资金")

    st = update_equity(equity, login)

    if st.get("halted"):

        raise PermissionError(st.get("halt_reason") or "日风控已触发")





def risk_status(
    equity: float,
    login: int,
    *,
    audit_limit: int = 0,
    gateway_version: str | None = None,
) -> dict[str, Any]:

    repair_if_baseline_mismatch(login, equity)

    cfg = get_config(login)

    rt = get_runtime(login)

    sk = session_key_for()

    start, end = session_window_bjt(sk)

    streak_sync = sync_consecutive_losses(login)

    rt = get_runtime(login)

    halted, halt_reason = is_trading_halted(login)

    st = update_equity(equity, login)

    until = next_session_start_bjt()

    pause_until = _parse_until(rt.halted_until_bjt)

    is_streak_pause = bool(

        pause_until and pause_until < until and halt_reason and "连续止损" in (halt_reason or "")

    )

    result: dict[str, Any] = {

        "account_login": login,

        "config": asdict(cfg),

        "runtime": asdict(rt),

        "session_key": sk,

        "session_start_bjt": start.isoformat(),

        "session_end_bjt": end.isoformat(),

        "bjt_now": bjt_now().isoformat(),

        "halted": halted,

        "halt_reason": halt_reason,

        "params_locked": params_locked_for_session(login),

        "halted_until_bjt": rt.halted_until_bjt,

        "next_unlock_bjt": until.isoformat(),

        "consecutive_losses": rt.consecutive_losses,

        "streak_tier3_armed": rt.streak_tier3_armed,

        "streak_enabled": cfg.streak_enabled,

        "streak_sync": streak_sync,

        "halt_kind": "streak" if is_streak_pause else ("daily" if halted else None),

        "suggested_caps": suggest_caps_for_equity(risk_notional_equity(cfg, equity)),

        "exposure": exposure_summary(equity, login),

        **{k: v for k, v in st.items() if k not in ("equity", "session_key", "halted", "halt_reason")},

    }

    if gateway_version:

        result["gateway_version"] = gateway_version

    if audit_limit > 0:

        from risk_event_log import audit_bundle

        result["audit"] = audit_bundle(login, limit=min(int(audit_limit), 200))

    return result


def exposure_summary(equity: float, login: int) -> dict[str, Any]:

    cfg = get_config(login)

    from mt5_trading import MAGIC, account_leverage, foreign_symbol_exposure, list_orders, list_positions, resolve_symbol, total_app_margin_usd

    sym = resolve_symbol()

    app_pos = list_positions(sym, MAGIC)

    app_ord = list_orders(sym, MAGIC)

    used_slots = len(app_pos) + len(app_ord)

    lev = account_leverage()

    budget = max_margin_budget_usd(cfg, lev, equity)

    used_margin = total_app_margin_usd(sym)

    foreign = foreign_symbol_exposure(sym) if cfg.app_magic_only else {"count": 0}

    return {

        "app_magic": MAGIC,

        "app_open_slots": used_slots,

        "max_combined_slots": int(cfg.max_combined_slots or 6),

        "margin_used_usd": used_margin,

        "margin_budget_usd": budget,

        "risk_notional_usd": risk_notional_equity(cfg, equity),

        "leverage": lev,

        "foreign_exposure_count": foreign.get("count", 0),

    }


