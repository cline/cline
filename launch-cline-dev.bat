@echo off
REM Cline Dev Launcher - Auto-syncs dev build to install location before launch
REM Improved: Proper process waiting, retry logic, file-in-use handling

set DEV_DIR=C:\Users\ftsachev\dev\cline\apps\examples\desktop-app\src-tauri\target\release
set INSTALL_DIR=C:\Users\ftsachev\AppData\Local\Cline
set MAX_RETRIES=5
set RETRY_DELAY=2

echo Checking for dev build updates...

REM Check if dev build exists
if not exist "%DEV_DIR%\cline-app.exe" (
    echo Dev build not found at %DEV_DIR%
    echo Run 'bun run build:binary' in apps/examples/desktop-app first
    pause
    exit /b 1
)

REM Kill any running Cline processes and wait for exit
echo Stopping existing Cline processes...
taskkill /f /im cline-app.exe >nul 2>&1
taskkill /f /im code-sidecar.exe >nul 2>&1

REM Wait for processes to fully exit (handles linger briefly)
timeout /t 2 /nobreak >nul

REM Verify processes are gone, force wait if needed
REM NOTE: tasklist ANDs multiple /fi filters, so filter on one image at a time.
set WAIT_COUNT=0
:WAIT_LOOP
tasklist /fi "imagename eq cline-app.exe" 2>nul | find /i "cline-app.exe" >nul
if not %ERRORLEVEL% equ 0 goto WAIT_LOOP_DONE
tasklist /fi "imagename eq code-sidecar.exe" 2>nul | find /i "code-sidecar.exe" >nul
if not %ERRORLEVEL% equ 0 goto WAIT_LOOP_DONE
if %WAIT_COUNT% geq 10 (
    echo Warning: Processes still running after 10s, continuing anyway...
    goto COPY_FILES
)
timeout /t 1 /nobreak >nul
set /a WAIT_COUNT+=1
goto WAIT_LOOP
:WAIT_LOOP_DONE

:COPY_FILES
REM Copy with retry logic for file-in-use errors
echo Syncing dev build to %INSTALL_DIR%...

set RETRY=0
:COPY_CLINE
if %RETRY% geq %MAX_RETRIES% (
    echo ERROR: Failed to copy cline-app.exe after %MAX_RETRIES% retries
    exit /b 1
)
copy /y "%DEV_DIR%\cline-app.exe" "%INSTALL_DIR%\cline-app.exe" >nul 2>&1
if %ERRORLEVEL% equ 0 (
    echo [OK] Copied cline-app.exe
) else (
    echo Retry %RETRY%/%MAX_RETRIES%: cline-app.exe in use, waiting %RETRY_DELAY%s...
    timeout /t %RETRY_DELAY% /nobreak >nul
    set /a RETRY+=1
    goto COPY_CLINE
)

set RETRY=0
:COPY_SIDECAR
if %RETRY% geq %MAX_RETRIES% (
    echo ERROR: Failed to copy code-sidecar.exe after %MAX_RETRIES% retries
    exit /b 1
)
copy /y "%DEV_DIR%\code-sidecar.exe" "%INSTALL_DIR%\code-sidecar.exe" >nul 2>&1
if %ERRORLEVEL% equ 0 (
    echo [OK] Copied code-sidecar.exe
) else (
    echo Retry %RETRY%/%MAX_RETRIES%: code-sidecar.exe in use, waiting %RETRY_DELAY%s...
    timeout /t %RETRY_DELAY% /nobreak >nul
    set /a RETRY+=1
    goto COPY_SIDECAR
)

echo Launching Cline...
start "" "%INSTALL_DIR%\cline-app.exe"

exit /b 0