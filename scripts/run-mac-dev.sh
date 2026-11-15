#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if ! command -v node >/dev/null; then
  echo "需要 Node.js LTS"; exit 1
fi

cleanup() {
  kill "$GW_PID" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

node gateway-mac/server.mjs &
GW_PID=$!

echo "网关 PID=$GW_PID  (5191)"
echo "前端: http://127.0.0.1:5190"
npm run dev
