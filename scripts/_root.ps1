# 供 scripts/*.ps1 引用：win-trade-terminal 根目录
$script:WinTradeRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path

function Get-WinTradeRoot {
    return $script:WinTradeRoot
}

function Ensure-NodePath {
    $nodeDir = Join-Path $env:LOCALAPPDATA "Temp\node-v22.12.0-win-x64"
    if ((Test-Path (Join-Path $nodeDir "npm.cmd")) -and ($env:PATH -notlike "*$nodeDir*")) {
        $env:PATH = "$nodeDir;$env:PATH"
    }
}

function Find-PythonW {
    $cmd = Get-Command pythonw.exe -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }
    try {
        $py = & py -3 -c "import sys; print(sys.executable)" 2>$null
        if ($py) {
            $w = Join-Path (Split-Path $py -Parent) "pythonw.exe"
            if (Test-Path $w) { return $w }
        }
    } catch { }
    return $null
}

function Test-PortListening([int]$Port) {
    try {
        $c = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction Stop
        return $null -ne $c
    } catch {
        return [bool](netstat -ano | Select-String ":$Port\s+.*LISTENING")
    }
}

function Stop-PortListeners([int]$Port) {
    try {
        Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue |
            ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }
    } catch { }
    netstat -ano | Select-String ":$Port\s+.*LISTENING" | ForEach-Object {
        if ($_ -match "\s(\d+)\s*$") {
            Stop-Process -Id ([int]$Matches[1]) -Force -ErrorAction SilentlyContinue
        }
    }
}

function Wait-HttpOk([string]$Url, [int]$TimeoutSec = 90) {
    for ($i = 0; $i -lt $TimeoutSec; $i++) {
        try {
            $r = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 2
            if ($r.StatusCode -ge 200 -and $r.StatusCode -lt 500) { return $true }
        } catch { }
        Start-Sleep -Seconds 1
    }
    return $false
}

function Open-AppWindow([string]$Url) {
    $edge86 = "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe"
    $edge64 = "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe"
    $chrome = "$env:ProgramFiles\Google\Chrome\Application\chrome.exe"
    if (Test-Path $edge64) {
        Start-Process $edge64 @("--app=$Url", "--new-window")
        return
    }
    if (Test-Path $edge86) {
        Start-Process $edge86 @("--app=$Url", "--new-window")
        return
    }
    if (Test-Path $chrome) {
        Start-Process $chrome @("--app=$Url", "--new-window")
        return
    }
    Start-Process $Url
}
