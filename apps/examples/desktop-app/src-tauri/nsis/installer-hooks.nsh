; Tauri's installer only stops the main binary (CheckIfAppIsRunning in its
; utils.nsh). The bundled sidecar re-executes itself as the detached Cline Hub
; daemon, which by design outlives the app and so keeps code-sidecar.exe
; locked. Without this, updating fails with "Error opening file for writing"
; (and uninstalling leaves the exe behind) until the user kills that process
; by hand.
;
; Match on the full path rather than the image name: the production Hub is
; shared per machine, and a code-sidecar.exe from another install (e.g. the
; side-by-side Cline Beta) may be hosting it without locking ours. The path
; travels through an environment variable so it never needs quoting inside
; the PowerShell command ($INSTDIR contains the username).
;
; The path has to come from WMI, not Get-Process. NSIS installers are 32-bit,
; so nsExec resolves powershell.exe through WOW64 redirection to the 32-bit
; PowerShell, whose Process.Path (MainModule.FileName) fails for 64-bit
; processes and reads as $null, so a Path-based filter never matches the
; sidecar and kills nothing. Win32_Process.ExecutablePath is resolved by the
; WMI service and does not depend on the caller's bitness.
!macro STOP_SIDECAR_PROCESSES
  System::Call 'kernel32::SetEnvironmentVariable(t "CLINE_SIDECAR_EXE", t "$INSTDIR\code-sidecar.exe")'
  nsExec::ExecToLog `powershell.exe -NoProfile -NonInteractive -Command "Get-CimInstance Win32_Process | Where-Object { $$_.ExecutablePath -eq $$env:CLINE_SIDECAR_EXE } | ForEach-Object { Stop-Process -Id $$_.ProcessId -Force -PassThru -ErrorAction SilentlyContinue } | Wait-Process -Timeout 10 -ErrorAction SilentlyContinue"`
  Pop $R0
  ; TerminateProcess returns before the file handle is released; same wait
  ; Tauri uses after killing the main binary.
  Sleep 500
!macroend

!macro NSIS_HOOK_PREINSTALL
  !insertmacro STOP_SIDECAR_PROCESSES
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  !insertmacro STOP_SIDECAR_PROCESSES
!macroend
