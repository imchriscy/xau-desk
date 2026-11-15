#!/usr/bin/env bash
# 为 Wine MT5 生成 Mt5IpcBridge.dll（PE，x64，__stdcall）
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$ROOT/native/mt5_ipc_client.cpp"
OUT="$ROOT/dist"
mkdir -p "$OUT"

GXX=""
if command -v x86_64-w64-mingw32-g++ &>/dev/null; then
  GXX="x86_64-w64-mingw32-g++"
else
  GXX="$("$(dirname "$0")/ensure-mingw-toolchain.sh")"
fi

"$GXX" -shared -O2 -std=c++17 \
  -DMT5IPC_EXPORTS \
  -o "$OUT/Mt5IpcBridge.dll" \
  "$SRC" \
  -lws2_32 \
  -static-libgcc -static-libstdc++ \
  -s

echo "已生成 $OUT/Mt5IpcBridge.dll"
file "$OUT/Mt5IpcBridge.dll"