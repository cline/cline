Unicode true
RequestExecutionLevel user
ManifestDPIAware true
SetCompressor /SOLID lzma
SetCompressorDictSize 32

!include "MUI2.nsh"
!include "LogicLib.nsh"
!include "x64.nsh"
!include "WinMessages.nsh"

Name "Cline CLI"
OutFile "${OUTPUT_FILE}"
InstallDir "$PROFILE\cline"
InstallDirRegKey HKCU "${INSTALL_KEY}" "InstallLocation"
BrandingText "Cline CLI"
VIProductVersion "${NUMERIC_VERSION}"
VIAddVersionKey /LANG=1033 "ProductName" "Cline CLI"
VIAddVersionKey /LANG=1033 "FileDescription" "Cline CLI installer for Windows ${ARCH}"
VIAddVersionKey /LANG=1033 "FileVersion" "${VERSION}"
VIAddVersionKey /LANG=1033 "ProductVersion" "${VERSION}"
VIAddVersionKey /LANG=1033 "LegalCopyright" "Cline"

!define MUI_ABORTWARNING
!define MUI_WELCOMEPAGE_TEXT "Install Cline CLI ${VERSION} for your Windows user.$\r$\n$\r$\nThe default folder is $PROFILE\cline. Setup adds its bin folder to your user PATH so you can run cline from your terminal."
!define MUI_FINISHPAGE_TEXT "Cline CLI is installed in:$\r$\n$INSTDIR$\r$\n$\r$\nOpen a new terminal and run:$\r$\ncline$\r$\n$\r$\nIf your terminal app was already open, close and reopen it to refresh PATH."
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "English"

!macro Initialize
  SetShellVarContext current
  SetRegView 64
  InitPluginsDir
  File /oname=$PLUGINSDIR\environment.ps1 "${ENVIRONMENT_SCRIPT}"
!macroend

Function .onInit
  !if "${ARCH}" == "arm64"
    ${IfNot} ${IsNativeARM64}
      MessageBox MB_OK|MB_ICONSTOP "This installer requires Windows on ARM64. Use the x64 installer for Intel or AMD PCs." /SD IDOK
      SetErrorLevel 1
      Abort
    ${EndIf}
  !else
    ${If} ${IsNativeIA32}
      MessageBox MB_OK|MB_ICONSTOP "This installer requires 64-bit Windows." /SD IDOK
      SetErrorLevel 1
      Abort
    ${EndIf}
  !endif
  !insertmacro Initialize
FunctionEnd

Function un.onInit
  !insertmacro Initialize
FunctionEnd

; Opening the executable for writing without truncating it checks Windows'
; actual image lock. Process registries can retain already-exited processes.
; Only this installation is checked, and no running process is stopped.
!macro CheckRunningCLI PREFIX
Function ${PREFIX}CheckRunningCLI
  IfFileExists "$INSTDIR\bin\cline.exe" 0 done
  retry:
    StrCpy $3 25
  probe:
    System::Call 'kernel32::CreateFileW(w "$INSTDIR\bin\cline.exe", i 0x40000000, i 7, p 0, i 3, i 0x80, p 0) p .r0 ?e'
    Pop $1
    ${If} $0 != -1
      System::Call 'kernel32::CloseHandle(p r0)'
      Goto done
    ${EndIf}
    StrCpy $0 $1
    ; Antivirus scanners may briefly hold a newly written executable.
    ${If} $0 == 32
      IntOp $3 $3 - 1
      ${If} $3 > 0
        Sleep 200
        Goto probe
      ${EndIf}
    ${EndIf}
    MessageBox MB_RETRYCANCEL|MB_ICONSTOP "Close Cline, then stop its background hub:$\r$\n$\"$INSTDIR\bin\cline.exe$\" hub stop$\r$\n$\r$\nThen retry setup. Windows error: $0." /SD IDCANCEL IDRETRY retry
    SetErrorLevel 2
    Abort
  done:
FunctionEnd
!macroend
!insertmacro CheckRunningCLI ""
!insertmacro CheckRunningCLI "un."

!macro UpdatePath ACTION
  ; Native PowerShell and .NET edit the full registry string, preserving both
  ; unexpanded variables and PATH values longer than NSIS's string buffer.
  ${DisableX64FSRedirection}
  nsExec::ExecToStack '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$PLUGINSDIR\environment.ps1" -Action ${ACTION} -InstallDir "$INSTDIR" -EnvironmentKey "${ENVIRONMENT_KEY}" -InstallKey "${INSTALL_KEY}"'
  ${EnableX64FSRedirection}
  Pop $0
  Pop $1
  ${If} $0 != 0
    MessageBox MB_OK|MB_ICONSTOP "Could not update your user PATH.$\r$\n$1" /SD IDOK
    SetErrorLevel 3
    Abort
  ${EndIf}
  System::Call 'user32::SendMessageTimeoutW(p 0xffff, i ${WM_SETTINGCHANGE}, p 0, w "Environment", i 2, i 5000, *p .r0)'
!macroend

Section "Install"
  Call CheckRunningCLI
  !include "${INSTALL_FILES}"
  SetOutPath "$INSTDIR"
  WriteUninstaller "$INSTDIR\Uninstall.exe"
  !insertmacro UpdatePath Add
  WriteRegStr HKCU "${INSTALL_KEY}" "DisplayName" "Cline CLI (${ARCH})"
  WriteRegStr HKCU "${INSTALL_KEY}" "DisplayVersion" "${VERSION}"
  WriteRegStr HKCU "${INSTALL_KEY}" "Publisher" "Cline"
  WriteRegStr HKCU "${INSTALL_KEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "${INSTALL_KEY}" "DisplayIcon" "$INSTDIR\bin\cline.exe"
  WriteRegStr HKCU "${INSTALL_KEY}" "UninstallString" '$\"$INSTDIR\Uninstall.exe$\"'
  WriteRegStr HKCU "${INSTALL_KEY}" "QuietUninstallString" '$\"$INSTDIR\Uninstall.exe$\" /S'
  WriteRegDWORD HKCU "${INSTALL_KEY}" "EstimatedSize" ${ESTIMATED_SIZE}
  WriteRegDWORD HKCU "${INSTALL_KEY}" "NoModify" 1
  WriteRegDWORD HKCU "${INSTALL_KEY}" "NoRepair" 1
  SetErrorLevel 0
SectionEnd

Section "Uninstall"
  Call un.CheckRunningCLI
  !insertmacro UpdatePath Remove
  !include "${UNINSTALL_FILES}"
  Delete "$INSTDIR\Uninstall.exe"
  RMDir "$INSTDIR"
  DeleteRegKey HKCU "${INSTALL_KEY}"
  SetErrorLevel 0
SectionEnd
