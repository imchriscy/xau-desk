#!/usr/bin/env bash
# macOS 本机 .so — 仅用于与 Python 服务端协议联调，不能给 MQL5 #import
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$ROOT/native/mt5_ipc_client.cpp"
OUT="$ROOT/dist"
mkdir -p "$OUT"

g++ -shared -fPIC -O2 -std=c++17 \
  -o "$OUT/libMt5IpcBridge.dylib" \
  "$SRC"

echo "已生成 $OUT/libMt5IpcBridge.dylib（本机测试用，非 MQL5 DLL）"