#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

ARCH="$(uname -m)"
APP_SRC=""
if [[ -d "$ROOT/release/mac-arm64/XauDesk.app" ]]; then
  APP_SRC="$ROOT/release/mac-arm64/XauDesk.app"
elif [[ -d "$ROOT/release/mac/XauDesk.app" ]]; then
  APP_SRC="$ROOT/release/mac/XauDesk.app"
elif [[ -d "$ROOT/release/mac-$ARCH/XauDesk.app" ]]; then
  APP_SRC="$ROOT/release/mac-$ARCH/XauDesk.app"
else
  echo "未找到 release/**/XauDesk.app，请先: npm run mac:pack"
  exit 1
fi

DEST="$HOME/Applications/XauDesk.app"
rm -rf "$DEST"
ditto "$APP_SRC" "$DEST"
xattr -cr "$DEST" 2>/dev/null || true

echo "已安装: $DEST"
echo "可从启动台 / 应用程序 打开 XauDesk"
open -a "$DEST" 2>/dev/null || open "$DEST"
