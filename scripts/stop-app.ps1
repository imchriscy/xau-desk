# 结束 5190 / 5191 监听进程（无窗口）
. "$PSScriptRoot\_root.ps1"
Stop-PortListeners 5191
Stop-PortListeners 5190
Start-Sleep -Seconds 1
