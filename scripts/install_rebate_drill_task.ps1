# 在 VPS 上以登录触发：限价返佣演习 runner（需已部署代码 + MT5 已开）
param(
  [string]$Backend = "C:\opt\ming-xau-scalp\xau_scalp_mt5\win-trade-terminal\backend",
  [switch]$Live
)
$py = (Get-Command py -ErrorAction SilentlyContinue).Source
if (-not $py) { throw "py not found" }
$argLive = if ($Live) { "--live" } else { "" }
$action = New-ScheduledTaskAction -Execute $py -Argument "-3 limit_rebate_runner.py --config config\limit_rebate_tmgm_demo.json $argLive" -WorkingDirectory $Backend
$trigger = New-ScheduledTaskTrigger -AtLogOn
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable
Register-ScheduledTask -TaskName "MingRebateDrillRunner" -Action $action -Trigger $trigger -Settings $settings -Force
Write-Host "Registered MingRebateDrillRunner -> $Backend"
