@echo off
cd /d "%~dp0"

where npm >nul 2>&1
if errorlevel 1 (
  if exist "%LOCALAPPDATA%\Temp\node-v22.12.0-win-x64\npm.cmd" (
    set "PATH=%LOCALAPPDATA%\Temp\node-v22.12.0-win-x64;%PATH%"
    echo [win-trade] 使用临时 Node: %LOCALAPPDATA%\Temp\node-v22.12.0-win-x64
  ) else (
    echo [win-trade] 未找到 npm。请安装 Node.js LTS 或解压 node-v22-win-x64 到 %%LOCALAPPDATA%%\Temp\
    pause
    exit /b 1
  )
)

if not exist node_modules (
  echo [win-trade] npm install ...
  call npm install
)

echo [win-trade] 浏览器打开 http://127.0.0.1:5190/
call npm run dev
