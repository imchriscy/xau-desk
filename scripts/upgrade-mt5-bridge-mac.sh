#!/usr/bin/env bash
# 编译并重启 MT5 以加载最新 XauDeskBridge（解决 bridge_ver 过旧、外部平仓不同步）
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
bash "$ROOT/scripts/compile-mt5-bridge-mac.sh"
bash "$ROOT/scripts/mt5-autoload-ea.sh"
BR="$(node "$ROOT/scripts/print-active-bridge-dir.mjs" 2>/dev/null || true)"
if [[ -n "$BR" && -f "$BR/xau_state.json" ]]; then
  python3 -c "import json; j=json.load(open('$BR/xau_state.json',encoding='latin-1')); print('bridge_ver=', j.get('bridge_ver'), 'positions=', len(j.get('positions',[])))"
fi
echo "完成。请 Cmd+Q 重开 XauDesk，再测：电脑开单 → 手机平仓。"