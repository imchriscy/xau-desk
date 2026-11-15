#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WINE_PREFIX="${WINE_PREFIX:-$HOME/Library/Application Support/net.metaquotes.wine.metatrader5}"
MT5="$WINE_PREFIX/drive_c/Program Files/MetaTrader 5"

cp -f "$ROOT/mql5/Include/BridgeRpc.mqh" "$ROOT/mql5/Include/TradeExec.mqh" "$MT5/MQL5/Include/"
cp -f "$ROOT/mql5/Experts/XauDeskBridge.mq5" "$MT5/MQL5/Experts/"

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
[[ -n "$WINE_BIN" ]] || { echo "未找到 wine64"; exit 1; }
cd "$MT5"
"$WINE_BIN" metaeditor64.exe "/compile:MQL5\\Experts\\XauDeskBridge.mq5" "/log:logs\\compile_bridge.log"
if tr -d '\0' < "$MT5/logs/compile_bridge.log" | grep -q "Result: 0 errors"; then
  mkdir -p "$ROOT/gateway-mac/mt5-payload"
  cp -f "$MT5/MQL5/Experts/XauDeskBridge.ex5" "$ROOT/gateway-mac/mt5-payload/XauDeskBridge.ex5"
  cp -f "$ROOT/mql5/Experts/XauDeskBridge.mq5" "$ROOT/gateway-mac/mt5-payload/XauDeskBridge.mq5"
fi
echo "已编译 XauDeskBridge.ex5，请重启 MT5 或运行 mt5-autoload-ea.sh"
