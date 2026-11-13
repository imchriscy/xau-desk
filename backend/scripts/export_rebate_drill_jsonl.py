#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""JSONL → CSV（复盘 / Excel / pandas）。"""

from __future__ import annotations

import argparse
import csv
import json
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
DEFAULT_JSONL = BACKEND / "logs" / "rebate_drill" / "events.jsonl"


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--jsonl", type=Path, default=DEFAULT_JSONL)
    ap.add_argument("--csv", type=Path, default=None)
    args = ap.parse_args()
    out = args.csv or args.jsonl.with_suffix(".csv")
    if not args.jsonl.is_file():
        raise SystemExit(f"missing {args.jsonl}")
    rows: list[dict] = []
    keys: set[str] = set()
    for line in args.jsonl.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        o = json.loads(line)
        rows.append(o)
        keys.update(o.keys())
    fieldnames = sorted(keys)
    with out.open("w", newline="", encoding="utf-8-sig") as f:
        w = csv.DictWriter(f, fieldnames=fieldnames, extrasaction="ignore")
        w.writeheader()
        for r in rows:
            flat = {k: (json.dumps(v, ensure_ascii=False) if isinstance(v, (dict, list)) else v) for k, v in r.items()}
            w.writerow(flat)
    print(json.dumps({"rows": len(rows), "csv": str(out)}, ensure_ascii=False))


if __name__ == "__main__":
    main()
