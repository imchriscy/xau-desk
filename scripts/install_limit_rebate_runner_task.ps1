#Requires -RunAsAdministrator
# 注册计划任务 MingLimitRebateRunner（需 MT5 已登录 + 算法交易允许）
param(
    [string]$TaskName = "MingLimitRebateRunner",
    [string]$RunBat = "$PSScriptRoot\run_limit_rebate_runner.bat"
)

$RunBat = [System.IO.Path]::GetFullPath($RunBat)
if (-not (Test-Path $RunBat)) {
    Write-Error "Missing: $RunBat"
    exit 1
}

Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue | Unregister-ScheduledTask -Confirm:$false

Get-CimInstance Win32_Process -Filter "Name='python.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -match 'limit_rebate_runner' } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }

$action = New-ScheduledTaskAction -Execute "cmd.exe" -Argument "/c `"$RunBat`"" -WorkingDirectory (Split-Path $RunBat -Parent)
$logon = New-ScheduledTaskTrigger -AtLogOn
$boot = New-ScheduledTaskTrigger -AtStartup
$boot.Delay = "PT3M"
$settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -StartWhenAvailable `
    -RestartCount 999 `
    -RestartInterval (New-TimeSpan -Minutes 1) `
    -ExecutionTimeLimit ([TimeSpan]::Zero)
$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Highest

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger @($logon, $boot) -Settings $settings -Principal $principal -Description "TMGM demo limit_rebate_runner --live (5m v003)" | Out-Null

Start-ScheduledTask -TaskName $TaskName
Write-Host "OK: $TaskName -> $RunBat"
Get-ScheduledTask -TaskName $TaskName | Format-List TaskName, State, TaskPath
Start-Sleep -Seconds 4
Get-CimInstance Win32_Process -Filter "Name='python.exe'" |
    Where-Object { $_.CommandLine -match 'limit_rebate_runner' } |
    Select-Object ProcessId, CommandLine | Format-List
