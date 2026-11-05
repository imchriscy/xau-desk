. "$PSScriptRoot\_root.ps1"
Stop-PortListeners 5191
Start-Sleep -Seconds 3
Stop-PortListeners 5191
Start-Sleep -Seconds 1

$Root = Get-WinTradeRoot
$logDir = Join-Path $Root "logs"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$pythonw = Find-PythonW
if (-not $pythonw) { exit 1 }
$backend = Join-Path $Root "backend"
$out = Join-Path $logDir "gateway.log"
$err = Join-Path $logDir "gateway.err.log"
Start-Process -FilePath $pythonw `
    -ArgumentList "serve_mt5.py" `
    -WorkingDirectory $backend `
    -WindowStyle Hidden `
    -RedirectStandardOutput $out `
    -RedirectStandardError $err | Out-Null
Wait-HttpOk "http://127.0.0.1:5191/api/version" 45 | Out-Null
try {
    $v = Invoke-RestMethod -Uri "http://127.0.0.1:5191/api/version" -TimeoutSec 5
    $line = "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') gateway restarted version=$($v.version)"
    Add-Content -Path $out -Value $line -Encoding utf8
} catch { }
