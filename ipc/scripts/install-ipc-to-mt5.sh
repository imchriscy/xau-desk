#!/usr/bin/env bash
# 复制 IPC 产物到 Wine MT5（DLL 需先 ./build-mingw-dll.sh）
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WINE_MT5="$HOME/Library/Application Support/net.metaquotes.wine.metatrader5/drive_c/Program Files/MetaTrader 5"
LIB="$WINE_MT5/MQL5/Libraries"
INC="$WINE_MT5/MQL5/Include"
EXP="$WINE_MT5/MQL5/Experts"

mkdir -p "$LIB" "$INC" "$EXP"

if [[ -f "$ROOT/dist/Mt5IpcBridge.dll" ]]; then
  cp -f "$ROOT/dist/Mt5IpcBridge.dll" "$LIB/"
  echo "DLL → $LIB/Mt5IpcBridge.dll"
else
  echo "WARN: $ROOT/dist/Mt5IpcBridge.dll 不存在。先运行: brew install mingw-w64 && $ROOT/scripts/build-mingw-dll.sh"
fi

cp -f "$ROOT/mql5/Include/Mt5IpcBridge.mqh" "$INC/"
cp -f "$ROOT/mql5/Experts/IpcBridgeSmokeTest.mq5" "$EXP/"
echo "Include + Expert 已同步"
echo "MT5: 选项 → 专家顾问 → 允许 DLL 导入；编译并挂载 IpcBridgeSmokeTest"