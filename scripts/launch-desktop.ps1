# 隐藏起网关+前端，再打开 Electron 桌面窗口（无 CMD）
. "$PSScriptRoot\_root.ps1"
$Root = Get-WinTradeRoot
$logDir = Join-Path $Root "logs"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
Ensure-NodePath

# 每次从桌面打开都重启 5191，避免旧 pythonw 占端口导致风控/审计接口仍是旧版
& "$PSScriptRoot\restart-gateway-hidden.ps1"
& "$PSScriptRoot\start-frontend-hidden.ps1"

$url = "http://127.0.0.1:5190/"
if (-not (Wait-HttpOk $url 90)) {
    Add-Content (Join-Path $logDir "launch.err.log") "[$(Get-Date)] 前端未就绪，请查看 logs/vite.err.log"
    exit 1
}

$electron = Join-Path $Root "node_modules\electron\dist\electron.exe"
if (-not (Test-Path $electron)) {
    Add-Content (Join-Path $logDir "launch.err.log") "[$(Get-Date)] 未安装 electron，请在 win-trade-terminal 目录执行 npm install"
    exit 1
}

Start-Process -FilePath $electron -ArgumentList ".", "--disable-gpu-sandbox" -WorkingDirectory $Root | Out-Null
