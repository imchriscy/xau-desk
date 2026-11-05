"""风控/系统事件审计 · 追加写入 · SHA256 哈希链（防篡改校验）。"""

from __future__ import annotations

import hashlib
import json
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

BJT = timezone(timedelta(hours=8))
LOG_PATH = Path(__file__).resolve().parent / "risk_events.jsonl"
MAX_LINES = 5000
GENESIS_HASH = "0" * 64


def _now_iso() -> str:
    return datetime.now(BJT).isoformat()


def _canonical_body(body: dict[str, Any]) -> str:
    return json.dumps(body, sort_keys=True, ensure_ascii=False, separators=(",", ":"))


def _row_hash(prev_hash: str, body: dict[str, Any]) -> str:
    payload = f"{prev_hash}|{_canonical_body(body)}"
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def _read_all_lines() -> list[str]:
    if not LOG_PATH.is_file():
        return []
    try:
        return LOG_PATH.read_text(encoding="utf-8").splitlines()
    except OSError:
        return []


def _last_record() -> tuple[int, str]:
    seq = 0
    prev = GENESIS_HASH
    for line in _read_all_lines():
        if not line.strip():
            continue
        try:
            row = json.loads(line)
        except json.JSONDecodeError:
            continue
        if row.get("row_hash"):
            seq = int(row.get("seq") or seq)
            prev = str(row["row_hash"])
    return seq, prev


def _append_row(row: dict[str, Any]) -> None:
    try:
        with LOG_PATH.open("a", encoding="utf-8") as f:
            f.write(json.dumps(row, ensure_ascii=False) + "\n")
        _trim_file()
    except OSError:
        pass


def log_risk_event(
    login: int,
    event: str,
    *,
    detail: str = "",
    payload: dict[str, Any] | None = None,
) -> None:
    seq, prev = _last_record()
    body = {
        "ts_bjt": _now_iso(),
        "login": int(login),
        "event": event,
        "detail": detail,
        "payload": payload or {},
    }
    row_hash = _row_hash(prev, body)
    _append_row({**body, "seq": seq + 1, "prev_hash": prev, "row_hash": row_hash})


def log_system_event(
    event: str,
    *,
    detail: str = "",
    payload: dict[str, Any] | None = None,
) -> None:
    """代码/网关系统性异常（login=0）。"""
    log_risk_event(0, event, detail=detail, payload=payload)


def verify_chain() -> dict[str, Any]:
    lines = _read_all_lines()
    prev = GENESIS_HASH
    checked = 0
    first_break: int | None = None
    legacy = 0
    for i, line in enumerate(lines, start=1):
        if not line.strip():
            continue
        try:
            row = json.loads(line)
        except json.JSONDecodeError:
            if first_break is None:
                first_break = i
            continue
        rh = row.get("row_hash")
        if not rh:
            legacy += 1
            continue
        body = {
            "ts_bjt": row.get("ts_bjt"),
            "login": row.get("login"),
            "event": row.get("event"),
            "detail": row.get("detail"),
            "payload": row.get("payload") or {},
        }
        expect_prev = row.get("prev_hash")
        if expect_prev != prev:
            if first_break is None:
                first_break = i
        expect_hash = _row_hash(str(expect_prev or GENESIS_HASH), body)
        if expect_hash != rh:
            if first_break is None:
                first_break = i
        else:
            checked += 1
            prev = rh
    return {
        "valid": first_break is None,
        "checked_rows": checked,
        "legacy_rows_without_hash": legacy,
        "first_break_line": first_break,
        "tip": "时间戳与哈希由网关追加；valid=false 表示链被破坏（可能被手工篡改）",
    }


def _trim_file() -> None:
    lines = _read_all_lines()
    if len(lines) <= MAX_LINES:
        return
    try:
        LOG_PATH.write_text("\n".join(lines[-MAX_LINES:]) + "\n", encoding="utf-8")
    except OSError:
        pass


def list_events(login: int | None = None, limit: int = 80) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for line in reversed(_read_all_lines()):
        if not line.strip():
            continue
        try:
            row = json.loads(line)
        except json.JSONDecodeError:
            continue
        if login is not None and int(row.get("login", -1)) != int(login):
            continue
        out.append(row)
        if len(out) >= limit:
            break
    return out


def audit_bundle(login: int | None, limit: int = 80) -> dict[str, Any]:
    return {
        "events": list_events(login, limit=limit),
        "integrity": verify_chain(),
        "log_path": str(LOG_PATH.name),
        "server_ts_bjt": _now_iso(),
    }
