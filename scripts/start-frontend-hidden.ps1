# 无窗口启动 Vite 前端 (5190)
. "$PSScriptRoot\_root.ps1"
$Root = Get-WinTradeRoot
$logDir = Join-Path $Root "logs"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
Ensure-NodePath

if (Test-PortListening 5190) {
    exit 0
}

$npm = Get-Command npm.cmd -ErrorAction SilentlyContinue
if (-not $npm) {
    Add-Content (Join-Path $logDir "vite.err.log") "[$(Get-Date)] 未找到 npm，请安装 Node.js LTS"
    exit 1
}

if (-not (Test-Path (Join-Path $Root "node_modules"))) {
    Start-Process -FilePath $npm.Source -ArgumentList "install" -WorkingDirectory $Root -WindowStyle Hidden -Wait
}

$out = Join-Path $logDir "vite.log"
$err = Join-Path $logDir "vite.err.log"

Start-Process -FilePath $npm.Source `
    -ArgumentList "run", "dev" `
    -WorkingDirectory $Root `
    -WindowStyle Hidden `
    -RedirectStandardOutput $out `
    -RedirectStandardError $err | Out-Null

Wait-HttpOk "http://127.0.0.1:5190/" 90 | Out-Null
