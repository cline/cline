#!/usr/bin/env pwsh
# Windows/PowerShell equivalent of run-extension-host.sh.
#
# tmux (used by the bash version to lay out 4 panes) isn't available on
# Windows by default, so this launches the same 4 watchers each in their own
# PowerShell window instead of tmux panes. Closing the main window (or
# pressing Ctrl+C here) stops the launcher; the watcher windows are closed
# individually (or via the cleanup block below, which best-effort kills them).

param(
    [string]$Workspace = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path,
    [string]$Environment = $(if ($env:CLINE_ENVIRONMENT) { $env:CLINE_ENVIRONMENT } else { "production" })
)

$ErrorActionPreference = "Stop"

Set-Location $Workspace

# Export env vars for this process and any child processes it spawns.
$env:IS_DEV = "true"
$env:DEV_WORKSPACE_FOLDER = $Workspace
$env:CLINE_ENVIRONMENT = $Environment

$envFile = Join-Path $Workspace ".env"
if (Test-Path $envFile) {
    Get-Content $envFile | ForEach-Object {
        if ($_ -match '^\s*([^#=]+?)\s*=\s*(.*)\s*$') {
            $name = $Matches[1]
            $value = $Matches[2]
            [System.Environment]::SetEnvironmentVariable($name, $value, "Process")
        }
    }
}

# Step 1: Build protos (everything depends on this)
Write-Host "Building protos..."
bun run protos
if ($LASTEXITCODE -ne 0) { Write-Error "Protos build failed"; exit 1 }

# Step 2: Build webview once
Write-Host "Building webview..."
bun run build:webview
if ($LASTEXITCODE -ne 0) { Write-Error "Webview build failed"; exit 1 }

# Step 3: Kill any windows left over from a previous run of this script.
Get-Process -Name "powershell", "pwsh" -ErrorAction SilentlyContinue |
    Where-Object { $_.MainWindowTitle -like "cline-dev:*" } |
    Stop-Process -Force -ErrorAction SilentlyContinue

# Step 4: Launch each watcher in its own window (tmux-pane equivalent).
$watcherProcesses = @()

function Start-WatcherWindow {
    param([string]$Title, [string]$Command)
    $psi = Start-Process -FilePath "powershell.exe" -ArgumentList @(
        "-NoExit",
        "-Command",
        "`$Host.UI.RawUI.WindowTitle = 'cline-dev: $Title'; Set-Location '$Workspace'; $Command"
    ) -PassThru
    return $psi
}

Write-Host "Starting watcher windows..."
$watcherProcesses += Start-WatcherWindow -Title "esbuild" -Command "bun run watch:esbuild"
$watcherProcesses += Start-WatcherWindow -Title "tsc" -Command "bun run watch:tsc"
$watcherProcesses += Start-WatcherWindow -Title "webview" -Command "bun run dev:webview"

# Step 5: Wait for the extension bundle to exist, then launch the Extension
# Development Host in this window (equivalent to the 4th tmux pane).
Write-Host "Waiting for dist/extension.js..."
$extensionJs = Join-Path $Workspace "dist\extension.js"
while (-not (Test-Path $extensionJs)) {
    Start-Sleep -Milliseconds 500
}

Write-Host "Launching Extension Host..."
code --extensionDevelopmentPath="$Workspace" `
    --disable-workspace-trust `
    --disable-extension saoudrizwan.claude-dev `
    --disable-extension saoudrizwan.cline-nightly `
    "$Workspace"
Write-Host "Extension Host launched."

Write-Host ""
Write-Host "Watcher windows (esbuild/tsc/webview) are running in separate PowerShell windows."
Write-Host "Close them manually, or press Enter here to stop them now."
Read-Host

foreach ($proc in $watcherProcesses) {
    Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
}
Write-Host "Stopped"
