param([string]$TaskName = "MingLimitRebateRunner")
$backend = Join-Path $PSScriptRoot "..\backend"
$events = Join-Path $backend "logs\rebate_drill\events.jsonl"
$log = Join-Path $backend "logs\rebate_drill\runner_stdout.log"

Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue | Format-List TaskName, State, LastRunTime, LastTaskResult
Get-CimInstance Win32_Process -Filter "Name='python.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -match 'limit_rebate_runner' } |
    Select-Object ProcessId, CommandLine
if (Test-Path $events) {
    Write-Host "--- events.jsonl (last 3) ---"
    Get-Content $events -Tail 3
}
if (Test-Path $log) {
    Write-Host "--- runner_stdout.log (last 8) ---"
    Get-Content $log -Tail 8
}
