#!/usr/bin/env bash
# 一次性配置：复制 EA → 编译 Bridge → 写入桥路径 → 可选自动挂 EA 并重启 MT5
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

echo "== XauDesk Mac 首次连接配置（约 1 分钟）=="
bash "$ROOT/scripts/install-mt5-ea-mac.sh"
bash "$ROOT/scripts/compile-mt5-bridge-mac.sh"

BRIDGE="$(node "$ROOT/scripts/print-active-bridge-dir.mjs")"
echo "桥目录: $BRIDGE"

WINE_USER="$(cd "$ROOT" && node -e "import { detectWineMt5Profile } from './scripts/detect-wine-mt5-profile.mjs'; process.stdout.write(detectWineMt5Profile().wineUser);")"
echo "Wine MT5 用户: $WINE_USER"

if [[ "${1:-}" == "--autoload" ]] || [[ "${MAC_SETUP_AUTOLOAD:-}" == "1" ]]; then
  bash "$ROOT/scripts/mt5-autoload-ea.sh"
else
  echo ""
  echo "日常只需两步："
  echo "  1) 打开 MT5，登录账户，工具栏点「算法交易」变绿"
  echo "  2) 打开 XauDesk，自动识别账户（换号后点 设置→刷新 MT5 连接）"
  echo ""
  echo "首次若未自动连上，可运行（自动开黄金图并挂 EA）："
  echo "  MT5_SYMBOL=XAUUSDm bash $ROOT/scripts/mt5-autoload-ea.sh"
  echo "  或手动：导航器 → 专家顾问 → XauDeskBridge → 拖到黄金图表"
fi
