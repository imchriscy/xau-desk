#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export MT5_IPC_SOCK="${MT5_IPC_SOCK:-/tmp/mt5_bridge.sock}"
exec python3 "$ROOT/native/mt5_bridge_server.py" --sock "$MT5_IPC_SOCK"