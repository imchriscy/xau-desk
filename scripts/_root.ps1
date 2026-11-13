# 供 scripts/*.ps1 引用：win-trade-terminal 根目录
$script:WinTradeRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path

function Get-WinTradeRoot {
    return $script:WinTradeRoot
}

function Refresh-PathFromRegistry {
    $machine = [Environment]::GetEnvironmentVariable("Path", "Machine")
    $user = [Environment]::GetEnvironmentVariable("Path", "User")
    $chunks = @()
    if (-not [string]::IsNullOrWhiteSpace($machine)) { $chunks += $machine }
    if (-not [string]::IsNullOrWhiteSpace($user)) { $chunks += $user }
    if ($chunks.Count -gt 0) {
        $env:PATH = ($chunks -join ";") + ";" + $env:PATH
    }
}

function Get-BundledNodeDir {
    return Join-Path $env:LOCALAPPDATA "Temp\node-v22.12.0-win-x64"
}

function Prepend-BundledNodePath {
    $nodeDir = Get-BundledNodeDir
    $npmCmd = Join-Path $nodeDir "npm.cmd"
    if (Test-Path $npmCmd) {
        if ($env:PATH -notlike "*$nodeDir*") {
            $env:PATH = "$nodeDir;$env:PATH"
        }
        return $npmCmd
    }
    return $null
}

function Find-NpmCmd {
    $bundled = Prepend-BundledNodePath
    if ($bundled) { return $bundled }
    $cmd = Get-Command npm.cmd -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }
    $cmd = Get-Command npm -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }
    $candidates = @(
        (Join-Path $env:LOCALAPPDATA "Temp\node-v22.12.0-win-x64\npm.cmd"),
        (Join-Path ${env:ProgramFiles} "nodejs\npm.cmd"),
        (Join-Path ${env:ProgramFiles(x86)} "nodejs\npm.cmd"),
        (Join-Path $env:APPDATA "npm\npm.cmd"),
        (Join-Path $env:LOCALAPPDATA "Programs\node\npm.cmd")
    )
    foreach ($p in $candidates) {
        if (Test-Path $p) { return $p }
    }
    $nvmHome = $env:NVM_HOME
    if ($nvmHome) {
        $link = Join-Path $nvmHome "npm.cmd"
        if (Test-Path $link) { return $link }
    }
    return $null
}

function Ensure-NodePath {
    Refresh-PathFromRegistry
    $npm = Find-NpmCmd
    if ($npm) {
        $dir = Split-Path $npm -Parent
        if ($env:PATH -notlike "*$dir*") {
            $env:PATH = "$dir;$env:PATH"
        }
        return $npm
    }
    $nodeDir = Join-Path $env:LOCALAPPDATA "Temp\node-v22.12.0-win-x64"
    if (Test-Path (Join-Path $nodeDir "npm.cmd")) {
        if ($env:PATH -notlike "*$nodeDir*") {
            $env:PATH = "$nodeDir;$env:PATH"
        }
        return (Join-Path $nodeDir "npm.cmd")
    }
    return $null
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
