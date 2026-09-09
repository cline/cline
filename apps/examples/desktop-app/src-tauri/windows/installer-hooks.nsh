; NSIS hooks spliced into Tauri's installer.nsi via
; bundle > windows > nsis > installerHooks (tauri.windows.conf.json).
;
; Tauri's installer only stops the main binary before replacing files. The
; bundled code-sidecar.exe (a compiled Bun binary) also runs as the detached
; shared Cline Hub daemon - the sidecar re-executes itself for that, see
; claimHubDaemonProcess in sidecar/index.ts - and as hub-hosted session
; children. Those outlive the sidecar the Tauri shell stops on restart, and
; Windows keeps a running executable's image locked, so the update failed
; with "Error opening file for writing: code-sidecar.exe" until the user
; ended those "Bun" processes by hand.
;
; Kill them by image name the same way the template's CheckIfAppIsRunning
; kills the main binary, including the currentUser scoping that keeps this
; from needing elevation. Unlike the main binary there is no prompt: these
; are background helpers the user never sees, and the sidecar is respawned by
; the app on launch.
!macro CLINE_KILL_SIDECAR_PROCESSES
  !if "${INSTALLMODE}" == "currentUser"
    nsis_tauri_utils::KillProcessCurrentUser "code-sidecar.exe"
  !else
    nsis_tauri_utils::KillProcess "code-sidecar.exe"
  !endif
  Pop $R0
  ; 0 = found and killed. TerminateProcess returns before the image lock is
  ; released, so give it a moment like the template does for the main binary.
  ${If} $R0 = 0
    Sleep 500
  ${EndIf}
!macroend

!macro NSIS_HOOK_PREINSTALL
  !insertmacro CLINE_KILL_SIDECAR_PROCESSES
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  !insertmacro CLINE_KILL_SIDECAR_PROCESSES
!macroend
