# UTF-16 VBS MsgBox · 避免 PowerShell 5 中文乱码
param(
    [Parameter(Mandatory)][string]$Message,
    [Parameter(Mandatory)][string]$LogDir,
    [string]$Title = "XauDesk"
)

$line = "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] $Message"
Add-Content -Path (Join-Path $LogDir "launch.err.log") -Value $line -Encoding UTF8

$body = ($Message -replace '"', '""')
$ttl = ($Title -replace '"', '""')
$vbsPath = Join-Path $env:TEMP "xaudesk-launch-err.vbs"
$vbs = "Option Explicit`r`nMsgBox ""$body"", 48, ""$ttl"""
$enc = New-Object System.Text.UnicodeEncoding $false, $true
[System.IO.File]::WriteAllText($vbsPath, $vbs, $enc)
Start-Process -FilePath "wscript.exe" -ArgumentList "//nologo", "`"$vbsPath`"" -Wait | Out-Null
