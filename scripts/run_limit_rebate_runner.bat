@echo off
setlocal
cd /d "%~dp0..\backend"
if not exist "logs\rebate_drill" mkdir "logs\rebate_drill"
set MT5_SYMBOL=XAUUSD
set PYTHONUNBUFFERED=1
if defined MT5_TERMINAL_PATH set "PATH=%PATH%"
echo === runner %date% %time% === >> logs\rebate_drill\runner_stdout.log
py -3 limit_rebate_runner.py --config config\limit_rebate_tmgm_demo.json --live >> logs\rebate_drill\runner_stdout.log 2>&1
echo === exit %errorlevel% %date% %time% === >> logs\rebate_drill\runner_stdout.log
endlocal
