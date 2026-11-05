Option Explicit
Dim sh, fso, root, desktop, lnkPath, sc, electron, wscriptExe
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
root = fso.GetParentFolderName(fso.GetParentFolderName(WScript.ScriptFullName))
desktop = sh.SpecialFolders("Desktop")
' ChrW 避免脚本编码导致桌面名称乱码
lnkPath = desktop & "\XauDesk " & ChrW(&H9EC4) & ChrW(&H91D1) & ".lnk"
wscriptExe = sh.ExpandEnvironmentStrings("%SystemRoot%") & "\System32\wscript.exe"
Set sc = sh.CreateShortcut(lnkPath)
sc.TargetPath = wscriptExe
sc.Arguments = "//nologo """ & root & "\run-desktop.vbs"""
sc.WorkingDirectory = root
sc.WindowStyle = 7
sc.Description = "XauDesk · MT5 XAUUSD Terminal"
electron = root & "\node_modules\electron\dist\electron.exe"
If fso.FileExists(electron) Then
  sc.IconLocation = electron & ",0"
Else
  sc.IconLocation = sh.ExpandEnvironmentStrings("%SystemRoot%") & "\System32\imageres.dll,109"
End If
sc.Save
