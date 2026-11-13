#!/usr/bin/env bash
# 同步 xau_scalp_mt5 到 MT5 Windows VPS（8.219.90.213）
set -euo pipefail

KEY="${MT5_SSH_KEY:-H:/Projects/2026-Developer-Code/89_售机个人与系统备份/SSH/id_ming_sg}"
HOST="${MT5_SSH_HOST:-Administrator@8.219.90.213}"
REMOTE_WIN="${MT5_REMOTE_DIR:-C:/opt/ming-xau-scalp}"

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT

echo "Pack from $ROOT"
TAR="$STAGE/deploy.tgz"
tar -C "$ROOT" -czf "$TAR" \
  --exclude='./output' \
  --exclude='./win-trade-terminal/node_modules' \
  --exclude='./win-trade-terminal/backend/.venv' \
  --exclude='./win-trade-terminal/backend/trade_journal.json' \
  --exclude='./xau-chart/node_modules' \
  .

echo "Upload to $HOST:$REMOTE_WIN"
ssh -i "$KEY" -o BatchMode=yes "$HOST" "powershell -NoProfile -Command \"New-Item -ItemType Directory -Force -Path '$REMOTE_WIN' | Out-Null\""
scp -i "$KEY" -o BatchMode=yes "$TAR" "$HOST:$REMOTE_WIN/deploy.tgz"

ssh -i "$KEY" -o BatchMode=yes "$HOST" "powershell -NoProfile -Command \"
  New-Item -ItemType Directory -Force -Path '$REMOTE_WIN/xau_scalp_mt5' | Out-Null;
  & tar.exe -xf '$REMOTE_WIN/deploy.tgz' -C '$REMOTE_WIN/xau_scalp_mt5';
  Remove-Item '$REMOTE_WIN/deploy.tgz' -ErrorAction SilentlyContinue;
  py -3 -m pip install -q MetaTrader5 pandas numpy
\""

BACKEND="$REMOTE_WIN/xau_scalp_mt5/win-trade-terminal/backend"
echo "Probe:"
ssh -i "$KEY" -o BatchMode=yes "$HOST" "powershell -NoProfile -Command \"\$env:MT5_SYMBOL='XAUUSD'; Set-Location '$BACKEND'; py -3 scripts/probe_mt5_account.py\""

echo "Done. Remote backend: $BACKEND"
