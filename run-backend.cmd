@echo off
cd /d "%~dp0backend"
echo [mt5-gateway] 需要: pip install MetaTrader5 ^(与 MT5 终端同机^)
echo [mt5-gateway] 可选: set MT5_SYMBOL=你的黄金品种名
echo [mt5-gateway] 可选: set MT5_TERMINAL_PATH=C:\Program Files\MetaTrader 5\terminal64.exe
py -3 serve_mt5.py
