#!/usr/bin/env bash
# 将最新 gateway-mac 打进已安装的 XauDesk.app，并写入用户级桥目录配置
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP="$HOME/Applications/XauDesk.app"
GW_DST="$APP/Contents/Resources/gateway-mac"
USER_CFG="$HOME/Library/Application Support/XauDesk/bridge-path.txt"

if [[ ! -d "$APP" ]]; then
  echo "未找到 $APP，请先 npm run mac:install"
  exit 1
fi

WINE_COMMON="$(node "$ROOT/scripts/print-active-bridge-dir.mjs" 2>/dev/null || true)"
WINE_COMMON="${WINE_COMMON:-$HOME/Library/Application Support/net.metaquotes.wine.metatrader5/drive_c/users/user/AppData/Roaming/MetaQuotes/Terminal/Common/Files}"

ditto "$ROOT/gateway-mac" "$GW_DST"
if [[ -d "$ROOT/dist" ]]; then
  for DST in \
    "$APP/Contents/Resources/app/dist" \
    "$APP/Contents/Resources/app.asar.unpacked/dist" \
    "$APP/Contents/Resources/dist"; do
    mkdir -p "$DST"
    ditto "$ROOT/dist" "$DST"
    echo "已同步前端 dist → $DST"
  done
fi
mkdir -p "$(dirname "$USER_CFG")"
mkdir -p "$WINE_COMMON"
printf '%s\n' "$WINE_COMMON" > "$USER_CFG"
printf '%s\n' "$WINE_COMMON" > "$GW_DST/bridge-path.txt"

echo "已更新网关 → $GW_DST"
echo "桥目录（用户配置）→ $USER_CFG"
echo "桥目录（当前 EA）→ $WINE_COMMON"
echo "请 Cmd+Q 退出 XauDesk 后重新打开；MT5 换券商后可在 设置→刷新 MT5 连接"
