#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
从 events.jsonl 汇总实战 parity 指标：挂单成功率、触价未成交、滑点、理论价偏差。
"""

from __future__ import annotations

import argparse
import json
import statistics
from collections import Counter, defaultdict
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
DEFAULT_JSONL = BACKEND / "logs" / "rebate_drill" / "events.jsonl"


def _f(x) -> float | None:
    try:
        return float(x)
    except (TypeError, ValueError):
        return None


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--jsonl", type=Path, default=DEFAULT_JSONL)
    ap.add_argument("--out", type=Path, default=None, help="写 summary JSON")
    ap.add_argument("--live-only", action="store_true", help="忽略 dry_run order_submit")
    args = ap.parse_args()
    if not args.jsonl.is_file():
        raise SystemExit(f"missing {args.jsonl}")

    events = [json.loads(l) for l in args.jsonl.read_text(encoding="utf-8").splitlines() if l.strip()]
    intents: dict[str, dict] = defaultdict(dict)
    for e in events:
        iid = e.get("intent_id")
        if not iid:
            continue
        k = e.get("kind")
        if k == "intent":
            intents[iid]["intent"] = e
        elif k == "order_submit":
            intents[iid]["submit"] = e
        elif k == "order_outcome":
            intents[iid]["outcome"] = e
        elif k == "fill_slip":
            intents[iid]["fill_slip"] = e
        elif k == "deal_entry":
            intents[iid]["deal_entry"] = e
        elif k == "deal_exit":
            intents[iid].setdefault("exits", []).append(e)
        elif k == "signal":
            intents[iid]["signal"] = e

    live_submits = []
    outcomes = Counter()
    touched_cancel = 0
    adverse_slips: list[float] = []
    fill_vs_passive: list[float] = []
    fill_vs_signal: list[float] = []

    for iid, bag in intents.items():
        sub = bag.get("submit") or {}
        res = sub.get("result") or {}
        if args.live_only and res.get("dry_run"):
            continue
        if sub.get("kind") != "order_submit":
            continue
        if not res.get("ok"):
            outcomes["submit_failed"] += 1
            continue
        live_submits.append(iid)
        oc = bag.get("outcome") or {}
        o = oc.get("outcome")
        if not o:
            if bag.get("fill_slip") or bag.get("deal_entry"):
                o = "filled"
            elif any(e.get("kind") == "ttl_expired" and e.get("intent_id") == iid for e in events):
                o = "cancelled_ttl"
            else:
                o = "pending"
        outcomes[o] += 1
        if o == "cancelled_ttl" and oc.get("price_touched_at_cancel"):
            touched_cancel += 1
        fs = bag.get("fill_slip") or oc
        adv = _f(fs.get("adverse_slip_usd"))
        if adv is not None:
            adverse_slips.append(adv)
        tm = fs.get("theory_match") or oc.get("theory_match") or {}
        fp = _f(tm.get("fill_minus_passive_usd"))
        if fp is not None:
            fill_vs_passive.append(fp)
        fsc = _f(tm.get("fill_minus_signal_close_usd"))
        if fsc is not None:
            fill_vs_signal.append(fsc)

    n_sub = len(live_submits)
    n_fill = outcomes.get("filled", 0)
    n_ttl = outcomes.get("cancelled_ttl", 0)

    def stats(xs: list[float]) -> dict | None:
        if not xs:
            return None
        return {
            "n": len(xs),
            "mean": round(statistics.mean(xs), 5),
            "stdev": round(statistics.stdev(xs), 5) if len(xs) > 1 else 0.0,
            "min": round(min(xs), 5),
            "max": round(max(xs), 5),
        }

    summary = {
        "jsonl": str(args.jsonl),
        "event_count": len(events),
        "kind_counts": dict(Counter(e.get("kind") for e in events)),
        "intents_tracked": len(intents),
        "live_order_submits": n_sub,
        "fill_rate": round(n_fill / n_sub, 4) if n_sub else None,
        "ttl_cancel_rate": round(n_ttl / n_sub, 4) if n_sub else None,
        "touch_but_ttl_cancel": touched_cancel,
        "outcome_breakdown": dict(outcomes),
        "adverse_slip_usd": stats(adverse_slips),
        "fill_minus_passive_usd": stats(fill_vs_passive),
        "fill_minus_signal_close_usd": stats(fill_vs_signal),
        "deal_exit_count": sum(1 for e in events if e.get("kind") == "deal_exit"),
    }

    out_path = args.out or args.jsonl.parent / "summary_latest.json"
    out_path.write_text(json.dumps(summary, indent=2, ensure_ascii=False), encoding="utf-8")
    print(json.dumps(summary, indent=2, ensure_ascii=False))
    print(json.dumps({"summary_file": str(out_path)}, ensure_ascii=False))


if __name__ == "__main__":
    main()
