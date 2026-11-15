#!/usr/bin/env bash
# 快速诊断 Mac MT5 ↔ XauDesk 桥接
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
COMMON="$(node "$ROOT/scripts/print-active-bridge-dir.mjs")"

echo "桥目录: $COMMON"
if [[ -f "$COMMON/xau_state.json" ]]; then
  python3 <<PY
import json, os, time
p="$COMMON/xau_state.json"
j=json.load(open(p, encoding="latin-1"))
age=int(time.time()-os.path.getmtime(p))
print(f"state 文件: 修改于 {age}s 前")
acc=j.get("account",{})
print(f"  缓存账户: #{acc.get('login')} @ {acc.get('server')}  sym={j.get('symbol')}")
if age>30:
    print("  → 状态过期：请在 MT5 当前黄金图挂 XauDeskBridge（算法交易开）")
PY
else
  echo "无 xau_state.json → 未挂 XauDeskBridge"
fi

EX5="$HOME/Library/Application Support/net.metaquotes.wine.metatrader5/drive_c/Program Files/MetaTrader 5/MQL5/Experts/XauDeskBridge.ex5"
[[ -f "$EX5" ]] && echo "EA 已编译: $EX5" || echo "缺 XauDeskBridge.ex5 → 运行 npm run mac:setup"

curl -s "http://127.0.0.1:5191/api/mt5/status" 2>/dev/null | python3 -m json.tool 2>/dev/null || echo "网关 5191 未响应（请先打开 XauDesk）"
