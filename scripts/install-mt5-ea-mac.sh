#!/usr/bin/env bash
# 将 XauDeskExec 复制到本机 MT5（含 Wine 版）数据目录
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
HOME="${HOME:-$(eval echo ~)}"

WINE_MT5="$HOME/Library/Application Support/net.metaquotes.wine.metatrader5/drive_c/Program Files/MetaTrader 5"
NATIVE_MT5_DATA=""

find_mt5_mql5() {
  if [[ -d "$WINE_MT5/MQL5" ]]; then
    echo "$WINE_MT5/MQL5"
    return
  fi
  local hit
  hit="$(find "$HOME/Library/Application Support" -maxdepth 6 -type d -path '*/MetaTrader 5/MQL5' 2>/dev/null | head -1)"
  if [[ -n "$hit" ]]; then
    echo "$hit"
    return
  fi
  echo ""
}

MQL5="$(find_mt5_mql5)"
if [[ -z "$MQL5" ]]; then
  echo "未找到 MT5 MQL5 目录。请确认 MetaTrader 5 已安装。"
  exit 1
fi

mkdir -p "$MQL5/Experts" "$MQL5/Include"
cp -f "$ROOT/mql5/Experts/XauDeskExec.mq5" "$ROOT/mql5/Experts/XauDeskBridge.mq5" "$MQL5/Experts/"
cp -f "$ROOT/mql5/Include/"*.mqh "$MQL5/Include/"

COMMON="$(node -e "import { bridgeDir } from './gateway-mac/resolve-bridge-dir.mjs'; console.log(bridgeDir());" 2>/dev/null || true)"
if [[ -z "$COMMON" ]]; then
  COMMON="$HOME/Library/Application Support/net.metaquotes.wine.metatrader5/drive_c/users/user/AppData/Roaming/MetaQuotes/Terminal/Common/Files"
fi

echo "MQL5:   $MQL5"
echo "Common: $COMMON"
echo ""
echo "下一步（在 MT5 内）："
echo "  1. MetaEditor → 先编译 Experts/XauDeskBridge.mq5 (F7) 打通连接"
echo "  2. 导航器 → XauDeskBridge 拖到图表（仅写状态；交易再用 XauDeskExec）"
echo "  或编译 XauDeskExec.mq5（完整热键/下单）"
echo "  3. 勾选「允许算法交易」；工具→选项→智能交易→允许:"
echo "     - 允许算法交易 / 允许 DLL / 允许 WebRequest (本地联调可不勾 WebRequest)"
echo "  4. 确认出现: $COMMON/xau_state.bin"
echo "  5. 重启 XauDesk.app"
