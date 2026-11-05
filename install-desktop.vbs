Option Explicit
Dim sh, fso, vbs
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
vbs = fso.GetParentFolderName(WScript.ScriptFullName) & "\scripts\create-desktop-shortcut.vbs"
sh.Run "wscript.exe //nologo """ & vbs & """", 0, True
MsgBox "已在桌面创建「MING XAU " & ChrW(&H4EA4) & ChrW(&H6613) & "」。" & vbCrLf & vbCrLf & "请先登录 MT5，再双击桌面图标进入。", 64, "MING"
