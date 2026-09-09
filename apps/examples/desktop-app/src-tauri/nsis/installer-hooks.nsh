; Tauri's installer only stops the main binary (CheckIfAppIsRunning in its
; utils.nsh). The bundled sidecar re-executes itself as the detached Cline Hub
; daemon, which by design outlives the app and so keeps code-sidecar.exe
; locked. Without this, updating fails with "Error opening file for writing"
; (and uninstalling leaves the exe behind) until the user kills that process
; by hand.
!macro STOP_SIDECAR_PROCESSES
  !if "${INSTALLMODE}" == "currentUser"
    nsis_tauri_utils::KillProcessCurrentUser "code-sidecar.exe"
  !else
    nsis_tauri_utils::KillProcess "code-sidecar.exe"
  !endif
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
