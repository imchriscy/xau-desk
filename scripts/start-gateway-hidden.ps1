# 确保 MT5 网关 (5191) 与 backend/serve_mt5.py 版本一致；不一致则隐藏重启
. "$PSScriptRoot\_root.ps1"

function Get-ExpectedGatewayVersion {
    $serve = Join-Path (Get-WinTradeRoot) "backend\serve_mt5.py"
    if (-not (Test-Path $serve)) { return $null }
    $m = Select-String -Path $serve -Pattern 'GATEWAY_VERSION\s*=\s*"([^"]+)"' -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($m) { return $m.Matches.Groups[1].Value }
    return $null
}

function Get-RunningGatewayVersion {
    try {
        $v = Invoke-RestMethod -Uri "http://127.0.0.1:5191/api/version" -TimeoutSec 3
        return [string]$v.version
    } catch {
        return $null
    }
}

if (Test-PortListening 5191) {
    $expected = Get-ExpectedGatewayVersion
    $running = Get-RunningGatewayVersion
    if ($expected -and $running -and ($running -eq $expected)) {
        exit 0
    }
}

& "$PSScriptRoot\restart-gateway-hidden.ps1"
