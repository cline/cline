$shell = New-Object -ComObject WScript.Shell
$shortcutPath = "$env:APPDATA\Microsoft\Internet Explorer\Quick Launch\User Pinned\TaskBar\Cline.lnk"

if (Test-Path $shortcutPath) {
    $shortcut = $shell.CreateShortcut($shortcutPath)
    $shortcut.TargetPath = "C:\Users\ftsachev\dev\cline\launch-cline-dev.bat"
    $shortcut.WorkingDirectory = "C:\Users\ftsachev\dev\cline"
    $shortcut.IconLocation = "C:\Users\ftsachev\dev\cline\apps\examples\desktop-app\src-tauri\icons\128x128.png,0"
    $shortcut.Description = "Cline Dev - Auto-syncs dev build on launch"
    $shortcut.Save()
    Write-Host "Taskbar shortcut updated"
} else {
    Write-Warning "Cline.lnk not found in TaskBar folder"
}