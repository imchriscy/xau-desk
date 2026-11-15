#!/usr/bin/env bash
# 不依赖 brew 源码编译：下载 llvm-mingw 预编译工具链（macOS universal）
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CACHE="$ROOT/tools/llvm-mingw"
VER="${LLVM_MINGW_VER:-20241119}"
ARCHIVE="llvm-mingw-${VER}-ucrt-macos-universal.tar.xz"
URL="https://github.com/mstorsjo/llvm-mingw/releases/download/${VER}/${ARCHIVE}"
TMP="/tmp/${ARCHIVE}"

find_gxx() {
  find "$CACHE" -path '*/bin/x86_64-w64-mingw32-g++' 2>/dev/null | head -1
}

GXX="$(find_gxx || true)"
if [[ -n "$GXX" ]]; then
  echo "$GXX"
  exit 0
fi

mkdir -p "$CACHE"
GXX="$(find_gxx || true)"
if [[ -n "$GXX" ]]; then
  echo "$GXX"
  exit 0
fi

if [[ ! -f "$TMP" ]] || [[ "$(stat -f%z "$TMP" 2>/dev/null || echo 0)" -lt 50000000 ]]; then
  echo "[llvm-mingw] 下载 $URL …" >&2
  curl -fL --retry 5 --retry-delay 3 -o "$TMP" "$URL"
fi

echo "[llvm-mingw] 解压 …" >&2
tar -xJf "$TMP" -C "$CACHE"
GXX="$(find_gxx || true)"
if [[ -z "$GXX" ]]; then
  echo "解压后未找到 x86_64-w64-mingw32-g++" >&2
  exit 1
fi
echo "$GXX"