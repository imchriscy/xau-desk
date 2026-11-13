# 隐藏起网关+前端，再打开 Electron 桌面窗口（无 CMD）
. "$PSScriptRoot\_root.ps1"

$Root = Get-WinTradeRoot
$logDir = Join-Path $Root "logs"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null

function Fail-Launch([string]$Message) {
    & "$PSScriptRoot\Show-LaunchError.ps1" -Message $Message -LogDir $logDir -Title "XauDesk"
    exit 1
}

Prepend-BundledNodePath | Out-Null
if (-not (Ensure-NodePath)) {
    Fail-Launch "未找到 npm / Node.js。`n请安装 Node.js LTS，或将 node 解压到 %LOCALAPPDATA%\Temp\node-v22.12.0-win-x64`n在本目录执行 npm install。详见 logs\vite.err.log"
}

$pythonw = Find-PythonW
if (-not $pythonw) {
    Fail-Launch "未找到 pythonw。请安装 Python 并 pip install MetaTrader5。详见 logs\gateway.err.log"
}

& "$PSScriptRoot\restart-gateway-hidden.ps1"
if (-not (Wait-HttpOk "http://127.0.0.1:5191/api/version" 45)) {
    Fail-Launch "MT5 网关 5191 未就绪。请确认 MT5 已登录且已开算法交易。详见 logs\gateway.err.log"
}

$npmPath = Ensure-NodePath
$nodeDir = (Split-Path $npmPath -Parent) -replace "'", "''"
$feScript = (Join-Path $PSScriptRoot "start-frontend-hidden.ps1") -replace "'", "''"
$psCmd = "& { `$env:PATH = '$nodeDir;' + `$env:PATH; & '$feScript'; if (`$null -ne `$LASTEXITCODE) { exit `$LASTEXITCODE } else { exit 0 } }"
$feProc = Start-Process -FilePath "powershell.exe" `
    -ArgumentList @("-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", $psCmd) `
    -WindowStyle Hidden -Wait -PassThru
$feCode = if ($null -ne $feProc.ExitCode) { [int]$feProc.ExitCode } else { 1 }

if ($feCode -ne 0) {
    Fail-Launch "前端 5190 未启动。常见原因：端口占用或 npm 不可用。`n请双击 run-dev.cmd 排查。详见 logs\vite.err.log"
}

if (-not (Wait-HttpOk "http://127.0.0.1:5190/" 15)) {
    Fail-Launch "前端未就绪，请查看 logs\vite.err.log"
}

$electron = Join-Path $Root "node_modules\electron\dist\electron.exe"
if (-not (Test-Path $electron)) {
    Fail-Launch "未安装 Electron。请在本目录执行 npm install"
}

Start-Process -FilePath $electron -ArgumentList ".", "--disable-gpu-sandbox" -WorkingDirectory $Root | Out-Null
