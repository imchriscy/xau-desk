# 委托 VBS 创建快捷方式（避免 PowerShell 中文路径乱码）
$vbs = Join-Path (Split-Path $PSScriptRoot -Parent) "scripts\create-desktop-shortcut.vbs"
$w = Join-Path $env:SystemRoot "System32\wscript.exe"
Start-Process -FilePath $w -ArgumentList "//nologo", "`"$vbs`"" -Wait -WindowStyle Hidden
