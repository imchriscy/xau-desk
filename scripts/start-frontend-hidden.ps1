# 无窗口启动 Vite 前端 (5190)
. "$PSScriptRoot\_root.ps1"
Prepend-BundledNodePath | Out-Null
$Root = Get-WinTradeRoot
$logDir = Join-Path $Root "logs"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$npmPath = Ensure-NodePath
if (-not $npmPath) {
    Add-Content (Join-Path $logDir "vite.err.log") "[$(Get-Date)] 未找到 npm。请安装 Node.js LTS 或将 node 加入系统 PATH 后重试。"
    exit 1
}

if (Test-PortListening 5190) {
    if (Wait-HttpOk "http://127.0.0.1:5190/" 5) { exit 0 }
    Stop-PortListeners 5190
    Start-Sleep -Seconds 1
}

$npm = Get-Item -LiteralPath $npmPath

if (-not (Test-Path (Join-Path $Root "node_modules"))) {
    Start-Process -FilePath $npm.FullName -ArgumentList "install" -WorkingDirectory $Root -WindowStyle Hidden -Wait
}

$out = Join-Path $logDir "vite.log"
$err = Join-Path $logDir "vite.err.log"
$nodeDir = Split-Path $npm.FullName -Parent
$env:PATH = "$nodeDir;$env:PATH"

Start-Process -FilePath $npm.FullName `
    -ArgumentList "run", "dev" `
    -WorkingDirectory $Root `
    -WindowStyle Hidden `
    -RedirectStandardOutput $out `
    -RedirectStandardError $err | Out-Null

if (-not (Wait-HttpOk "http://127.0.0.1:5190/" 90)) {
    Add-Content $err "[$(Get-Date)] Vite 5190 启动超时，请查看 vite.err.log"
    exit 1
}
exit 0
