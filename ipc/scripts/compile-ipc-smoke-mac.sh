#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
IPC="$ROOT/ipc"
WINE_ROOT="$HOME/Library/Application Support/net.metaquotes.wine.metatrader5"
MT5_DIR="$WINE_ROOT/drive_c/Program Files/MetaTrader 5"
WINE_BIN="/Applications/MetaTrader 5.app/Contents/SharedSupport/wine/bin/wine64"

bash "$IPC/scripts/install-ipc-to-mt5.sh"
cd "$MT5_DIR"
export WINEPREFIX="$WINE_ROOT"
export WINEDEBUG=-all

"$WINE_BIN" metaeditor64.exe "/compile:MQL5\\Experts\\IpcBridgeSmokeTest.mq5" "/log:logs\\compile_ipc.log" || true
LOG="$MT5_DIR/logs/compile_ipc.log"
if [[ -f "$LOG" ]]; then
  iconv -f UTF-16LE -t UTF-8 "$LOG" 2>/dev/null | tail -6 || tail -6 "$LOG"
fi
ls -la "$MT5_DIR/MQL5/Experts/IpcBridgeSmokeTest.ex5" 2>/dev/null || echo "ex5 未生成（多半缺 Mt5IpcBridge.dll）"