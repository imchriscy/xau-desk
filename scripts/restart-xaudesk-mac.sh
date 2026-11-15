#!/usr/bin/env bash
# 干净重启：杀占用 5190/5191 的进程并打开 XauDesk.app
set -euo pipefail
osascript -e 'quit app "XauDesk"' 2>/dev/null || true
pkill -f "XauDesk.app/Contents/MacOS/XauDesk" 2>/dev/null || true
pkill -f "gateway-mac/server.mjs" 2>/dev/null || true
pkill -f "vite preview" 2>/dev/null || true
sleep 1
lsof -tiTCP:5190,5191 2>/dev/null | xargs kill -9 2>/dev/null || true
sleep 1
APP="$HOME/Applications/XauDesk.app"
[[ -d "$APP" ]] || { echo "未安装 $APP"; exit 1; }
open "$APP"
echo "已重启 XauDesk（请先 Cmd+Q 关闭旧窗口若有）"
