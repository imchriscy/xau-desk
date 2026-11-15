#!/usr/bin/env bash
# 用 MT5 /config + [StartUp] 自动挂载 XauDeskBridge（无需手拖图表）
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

WINE_PREFIX="$HOME/Library/Application Support/net.metaquotes.wine.metatrader5"
TERMINAL="$WINE_PREFIX/drive_c/Program Files/MetaTrader 5/terminal64.exe"
WINE_USER="$(cd "$ROOT" && node -e "import { detectWineMt5Profile } from './scripts/detect-wine-mt5-profile.mjs'; process.stdout.write(detectWineMt5Profile().wineUser);")"
TERMINAL_USER_DIR="$WINE_PREFIX/drive_c/users/$WINE_USER/AppData/Roaming/MetaQuotes/Terminal"
INI_MAC="$TERMINAL_USER_DIR/xaudesk_startup.ini"
INI_WIN="C:\\\\users\\\\$WINE_USER\\\\AppData\\\\Roaming\\\\MetaQuotes\\\\Terminal\\\\xaudesk_startup.ini"

# 券商黄金命名不一，可通过环境变量覆盖
SYMBOL="${MT5_SYMBOL:-}"
if [[ -z "$SYMBOL" ]]; then
  for s in XAUUSDx XAUUSDm XAUUSD GOLD; do
    SYMBOL="$s"
    break
  done
  # 若已有 state，优先用其中的品种
  BRIDGE="$(node "$ROOT/scripts/print-active-bridge-dir.mjs" 2>/dev/null || true)"
  if [[ -n "$BRIDGE" && -f "$BRIDGE/xau_state.json" ]]; then
    SYMBOL="$(python3 -c "import json; print(json.load(open('$BRIDGE/xau_state.json',encoding='latin-1')).get('symbol') or '')" 2>/dev/null || true)"
  fi
  SYMBOL="${SYMBOL:-XAUUSDx}"
fi

PERIOD="${MT5_PERIOD:-M15}"
EXPERT="${MT5_EXPERT:-XauDeskBridge}"

mkdir -p "$TERMINAL_USER_DIR"

python3 - <<'PY' "$INI_MAC" "$SYMBOL" "$PERIOD" "$EXPERT"
import sys
path, symbol, period, expert = sys.argv[1:5]
text = (
    "[Experts]\r\n"
    "Enabled=1\r\n"
    "AllowLiveTrading=1\r\n"
    "AllowDllImport=1\r\n"
    "\r\n"
    "[StartUp]\r\n"
    f"Expert={expert}\r\n"
    f"Symbol={symbol}\r\n"
    f"Period={period}\r\n"
)
with open(path, "wb") as f:
    f.write(b"\xff\xfe")
    f.write(text.encode("utf-16le"))
PY

if [[ ! -f "$TERMINAL" ]]; then
  echo "未找到 terminal64.exe"
  exit 1
fi

if [[ ! -f "$WINE_PREFIX/drive_c/Program Files/MetaTrader 5/MQL5/Experts/XauDeskBridge.ex5" ]]; then
  echo "请先运行: bash scripts/compile-mt5-bridge-mac.sh"
  exit 1
fi

echo "将重启 MetaTrader 5（用户 $WINE_USER）并自动挂载 $EXPERT @ $SYMBOL $PERIOD"
osascript -e 'quit app "MetaTrader 5"' 2>/dev/null || true
sleep 3

export WINEPREFIX="$WINE_PREFIX"
export WINEDEBUG=-all

WINE_BIN=""
for c in \
  "/Applications/MetaTrader 5.app/Contents/SharedSupport/wine/bin/wine64" \
  "/Applications/MetaTrader 5.app/Contents/SharedSupport/wine/bin/wine" \
  "$(command -v wine64 2>/dev/null)" \
  "$(command -v wine 2>/dev/null)"; do
  [[ -x "$c" ]] && WINE_BIN="$c" && break
done

if [[ -z "$WINE_BIN" ]]; then
  echo "未找到 wine。请手动：导航器 → XauDeskBridge → 拖到 $SYMBOL 图表，并开启算法交易。"
  exit 1
fi

exec "$WINE_BIN" "$TERMINAL" /portable "/config:$INI_WIN"
