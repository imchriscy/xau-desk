# 一键：隐藏网关 + 隐藏前端 + 打开应用窗口（需 MT5 已在本机登录）
. "$PSScriptRoot\_root.ps1"
$Root = Get-WinTradeRoot
$logDir = Join-Path $Root "logs"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null

& "$PSScriptRoot\start-gateway-hidden.ps1"
& "$PSScriptRoot\start-frontend-hidden.ps1"

$url = "http://127.0.0.1:5190/"
if (Wait-HttpOk $url 15) {
    Open-AppWindow $url
} else {
    Add-Content (Join-Path $logDir "launch.err.log") "[$(Get-Date)] 前端未就绪，请查看 logs/vite.err.log"
}
