!include "Win\RestartManager.nsh"

; The Hub re-executes code-sidecar.exe as a detached daemon and outlives the
; desktop. Stop users of both installed executables before replacing either:
; stopping only the sidecar first leaves the desktop able to spawn it again.
;
; Restart Manager identifies users of the exact files across architectures.
; Do not use Get-Process.Path: NSIS is x86 even for an x64 bundle, and x86
; PowerShell returns an empty Path for x64 processes. Do not kill by image
; name either: another installation (e.g. Beta) must remain untouched.
!macro StopDesktopProcesses
  Push $0
  Push $1
  Push $2
  Push $3
  Push $4

  retry:
    System::Call 'rstrtmgr::RmStartSession(*i .r1, i 0, w .r2) i .r0'
    ${If} $0 == 0
      !insertmacro RestartManager_RegisterFile $1 "$INSTDIR\${MAINBINARYNAME}.exe"
      ${If} $0 == 0
        !insertmacro RestartManager_RegisterFile $1 "$INSTDIR\code-sidecar.exe"
      ${EndIf}
      ${If} $0 == 0
        StrCpy $3 0
        System::Call 'rstrtmgr::RmGetList(i r1, *i .r2, *i r3, p 0, *i .r4) i .r0'
        ${If} $0 == 234 ; ERROR_MORE_DATA: at least one process uses these files
          ; RmShutdown waits for shutdown; unlike TerminateProcess + Sleep,
          ; its return value tells us whether stopping the file users failed.
          System::Call 'rstrtmgr::RmShutdown(i r1, i ${RmForceShutdown}, p 0) i .r0'
        ${EndIf}
      ${EndIf}
      ; Release the session on every path, preserving the operation's error.
      System::Call 'rstrtmgr::RmEndSession(i r1)'
    ${EndIf}

    ${If} $0 != 0
      DetailPrint "Could not stop Cline processes in $INSTDIR (Restart Manager error $0)."
      ; Tauri's updater runs the installer passive (/P): the user who clicked
      ; "Restart now" is watching, and NSIS's own write-failure dialog would
      ; have shown in that mode anyway, so offer a retry. Silent (/S) takes
      ; the default and fails closed. Aborting rather than continuing keeps
      ; the install from ending half-replaced.
      MessageBox MB_RETRYCANCEL|MB_ICONSTOP "Could not stop Cline processes using files in:$\r$\n$INSTDIR$\r$\n$\r$\nClose Cline and its background tasks, then retry. Windows error: $0." /SD IDCANCEL IDRETRY retry
      Pop $4
      Pop $3
      Pop $2
      Pop $1
      Pop $0
      SetErrorLevel 2
      Abort
    ${EndIf}

  Pop $4
  Pop $3
  Pop $2
  Pop $1
  Pop $0
!macroend

!macro NSIS_HOOK_PREINSTALL
  !insertmacro CallArtificialFunction StopDesktopProcesses
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  !insertmacro CallArtificialFunction StopDesktopProcesses
!macroend
