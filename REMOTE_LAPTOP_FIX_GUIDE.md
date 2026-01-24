# Remote Laptop Fix Guide

**Created:** January 9, 2026  
**Purpose:** Fix Bcline extension issues on secondary laptop  
**Status:** PENDING - Waiting for SSH/remote connection

---

## Issues to Fix

### 1. ❌ Web UI Looks Different
**Cause:** The VSIX was packaged without building the webview first, so `webview-ui/build/` is missing or stale.

**Solution:** Rebuild webview and repackage VSIX (or rebuild directly on remote laptop).

### 2. ❌ Speech/Dictation Not Working  
**Cause:** FFmpeg is not installed or not in PATH on the remote laptop.

**Solution:** Install FFmpeg and add to system PATH.

**Expected FFmpeg locations checked by Cline:**
- System PATH
- `C:\ffmpeg\bin\ffmpeg.exe`
- `C:\Program Files\ffmpeg\bin\ffmpeg.exe`
- `C:\Program Files (x86)\ffmpeg\bin\ffmpeg.exe`

### 3. ❌ Copilot Messaging Not Working
**Cause:** MessageQueueService only initializes when a workspace FOLDER is open (not just files).

**Solution:** 
- Open a folder in VS Code (File → Open Folder)
- Verify `.message-queue` directory is created in workspace root
- Check VS Code Output panel for "Message Queue Service initialized"

---

## Step 0: Dependency Check (Run FIRST on Remote Laptop)

Run this comprehensive check to identify all missing dependencies:

```powershell
Write-Host "========================================" -ForegroundColor Cyan
Write-Host " BCLINE DEPENDENCY CHECK" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Node.js
Write-Host "1. Node.js:" -ForegroundColor Yellow
try {
    $nodeVersion = node --version 2>$null
    Write-Host "   ✅ Installed: $nodeVersion" -ForegroundColor Green
} catch {
    Write-Host "   ❌ NOT INSTALLED" -ForegroundColor Red
}

# npm
Write-Host "2. npm:" -ForegroundColor Yellow
try {
    $npmVersion = npm --version 2>$null
    Write-Host "   ✅ Installed: $npmVersion" -ForegroundColor Green
} catch {
    Write-Host "   ❌ NOT INSTALLED" -ForegroundColor Red
}

# Git
Write-Host "3. Git:" -ForegroundColor Yellow
try {
    $gitVersion = git --version 2>$null
    Write-Host "   ✅ Installed: $gitVersion" -ForegroundColor Green
} catch {
    Write-Host "   ❌ NOT INSTALLED" -ForegroundColor Red
}

# FFmpeg
Write-Host "4. FFmpeg:" -ForegroundColor Yellow
$ffmpegPath = (Get-Command ffmpeg -ErrorAction SilentlyContinue).Source
if ($ffmpegPath) {
    Write-Host "   ✅ Installed: $ffmpegPath" -ForegroundColor Green
} else {
    Write-Host "   ❌ NOT INSTALLED (Required for speech)" -ForegroundColor Red
}

# VS Code
Write-Host "5. VS Code:" -ForegroundColor Yellow
$codePath = (Get-Command code -ErrorAction SilentlyContinue).Source
if ($codePath) {
    Write-Host "   ✅ Installed: $codePath" -ForegroundColor Green
} else {
    Write-Host "   ❌ NOT INSTALLED or not in PATH" -ForegroundColor Red
}

# vsce (VS Code Extension packager)
Write-Host "6. vsce:" -ForegroundColor Yellow
try {
    $vsceVersion = vsce --version 2>$null
    Write-Host "   ✅ Installed: $vsceVersion" -ForegroundColor Green
} catch {
    Write-Host "   ❌ NOT INSTALLED (npm install -g @vscode/vsce)" -ForegroundColor Red
}

# Python (optional, for some features)
Write-Host "7. Python:" -ForegroundColor Yellow
try {
    $pythonVersion = python --version 2>$null
    Write-Host "   ✅ Installed: $pythonVersion" -ForegroundColor Green
} catch {
    Write-Host "   ⚠️  Not installed (optional)" -ForegroundColor Yellow
}

# winget
Write-Host "8. winget:" -ForegroundColor Yellow
$wingetPath = (Get-Command winget -ErrorAction SilentlyContinue).Source
if ($wingetPath) {
    Write-Host "   ✅ Available" -ForegroundColor Green
} else {
    Write-Host "   ❌ NOT AVAILABLE (needed for easy installs)" -ForegroundColor Red
}

# Check Bcline directory
Write-Host ""
Write-Host "9. Bcline Directory:" -ForegroundColor Yellow
$bclinePaths = @(
    "C:\Users\$env:USERNAME\Downloads\Bcline",
    "C:\Bcline",
    "D:\Bcline",
    "$env:USERPROFILE\Bcline"
)
$foundBcline = $false
foreach ($p in $bclinePaths) {
    if (Test-Path "$p\package.json") {
        Write-Host "   ✅ Found at: $p" -ForegroundColor Green
        $foundBcline = $true
        
        # Check webview build
        if (Test-Path "$p\webview-ui\build\assets\index.js") {
            Write-Host "   ✅ Webview build exists" -ForegroundColor Green
        } else {
            Write-Host "   ❌ Webview NOT built (npm run build:webview needed)" -ForegroundColor Red
        }
        
        # Check node_modules
        if (Test-Path "$p\node_modules") {
            Write-Host "   ✅ node_modules exists" -ForegroundColor Green
        } else {
            Write-Host "   ❌ node_modules missing (npm install needed)" -ForegroundColor Red
        }
        
        # Check webview node_modules
        if (Test-Path "$p\webview-ui\node_modules") {
            Write-Host "   ✅ webview-ui/node_modules exists" -ForegroundColor Green
        } else {
            Write-Host "   ❌ webview-ui/node_modules missing" -ForegroundColor Red
        }
        break
    }
}
if (-not $foundBcline) {
    Write-Host "   ❌ Bcline directory not found in common locations" -ForegroundColor Red
}

# Check installed VS Code extensions
Write-Host ""
Write-Host "10. Cline Extension:" -ForegroundColor Yellow
$extensions = code --list-extensions 2>$null
if ($extensions -match "claude") {
    Write-Host "   ✅ Cline extension installed" -ForegroundColor Green
} else {
    Write-Host "   ❌ Cline extension NOT installed" -ForegroundColor Red
}

# Check OpenSSH Server
Write-Host ""
Write-Host "11. OpenSSH Server:" -ForegroundColor Yellow
$sshService = Get-Service sshd -ErrorAction SilentlyContinue
if ($sshService) {
    Write-Host "   ✅ Installed, Status: $($sshService.Status)" -ForegroundColor Green
} else {
    Write-Host "   ❌ NOT INSTALLED" -ForegroundColor Red
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host " CHECK COMPLETE" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
```

---

## Fix Commands (Run on Remote Laptop)

### Step 1: Install Missing Dependencies

```powershell
# Install all missing tools via winget
winget install OpenJS.NodeJS.LTS    # Node.js + npm
winget install Git.Git               # Git
winget install Gyan.FFmpeg           # FFmpeg
winget install Microsoft.VisualStudioCode  # VS Code (if missing)

# Install vsce globally
npm install -g @vscode/vsce

# Restart PowerShell after installs to refresh PATH
```

### Step 2: Install FFmpeg
```powershell
# Install FFmpeg via winget
winget install Gyan.FFmpeg

# After install, restart PowerShell and verify:
where.exe ffmpeg
# Should return path like: C:\Users\<user>\AppData\Local\Microsoft\WinGet\Links\ffmpeg.exe
```

### Step 2: Rebuild Webview (if Bcline source is on remote laptop)
```powershell
# Navigate to Bcline directory
cd C:\path\to\Bcline

# Install dependencies
npm install
cd webview-ui
npm install

# Build the webview
npm run build

# Go back to root
cd ..

# Verify build exists
Test-Path "webview-ui\build\assets\index.js"
Test-Path "webview-ui\build\assets\index.css"
# Both should return True
```

### Step 3: Repackage VSIX (if rebuilding)
```powershell
# From Bcline root directory
npm run package

# Or full rebuild:
npm run clean:build
npm run protos
npm run build:webview
vsce package
```

### Step 4: Install New VSIX
```powershell
# Uninstall old version first
code --uninstall-extension saoudrizwan.claude-dev

# Install new VSIX
$vsix = (Get-ChildItem *.vsix | Sort-Object LastWriteTime -Descending | Select-Object -First 1).FullName
code --install-extension $vsix

# Restart VS Code
```

### Step 5: Verify Messaging Works
```powershell
# Open a FOLDER in VS Code (not just files!)
code C:\path\to\your\project

# In VS Code, check Output panel:
# View → Output → Select "Cline" from dropdown
# Look for: "Message Queue Service initialized"

# Test messaging by creating the queue file:
$queueDir = ".message-queue"
New-Item -ItemType Directory -Path $queueDir -Force
"test message" | Out-File "$queueDir\copilot-to-cline.txt" -Encoding UTF8
```

---

## Issue 4: Free Model Banner Not Showing

**Cause:** Banner is fetched from `https://api.cline.bot/banners/v1/messages`

**⚠️ NOTE:** Other laptop is on COMPANY NETWORK - likely blocking external APIs!
- Test with company network DISCONNECTED first
- If works without company network = corporate firewall issue

**Possible reasons:**
1. **Corporate firewall blocking `api.cline.bot`** (MOST LIKELY)
2. Network can't reach `api.cline.bot`
3. Auth token not valid/different
4. Banner dismissed and stored in extension state
5. Different API provider configured (banner has provider rules)

**Diagnostic:**
```powershell
# Test connectivity to Cline API
Invoke-WebRequest -Uri "https://api.cline.bot" -Method Head -TimeoutSec 5

# Check if firewall/antivirus blocking
Test-NetConnection -ComputerName "api.cline.bot" -Port 443
```

**Fix - Clear extension state to reset dismissed banners:**
```powershell
# Find and clear Cline extension storage
$clineStorage = "$env:APPDATA\Code\User\globalStorage\saoudrizwan.claude-dev"
if (Test-Path $clineStorage) {
    # Backup first
    Copy-Item $clineStorage "$clineStorage.backup" -Recurse -Force
    # Remove to reset state
    Remove-Item $clineStorage -Recurse -Force
    Write-Host "Cleared Cline extension storage - restart VS Code"
}
```

---

## Quick Diagnostic Commands

```powershell
# Check FFmpeg
where.exe ffmpeg
ffmpeg -version

# Check if webview build exists (run from Bcline dir)
Get-ChildItem "webview-ui\build\assets" -ErrorAction SilentlyContinue

# Check VS Code extensions
code --list-extensions | Select-String "claude"

# Check message queue directory (run from workspace root)
Test-Path ".message-queue"
Get-ChildItem ".message-queue" -ErrorAction SilentlyContinue
```

---

## SSH Setup Required on REMOTE Laptop

**THIS LAPTOP (Primary):** ✅ SSH Client ready (OpenSSH_for_Windows_9.5p2)

**OTHER LAPTOP (Remote):** Needs SSH Server enabled. Run these commands **as Administrator** on the other laptop:

```powershell
# 1. Check if OpenSSH Server is installed
Get-WindowsCapability -Online | Where-Object Name -like 'OpenSSH.Server*'

# 2. Install OpenSSH Server (if not installed)
Add-WindowsCapability -Online -Name OpenSSH.Server~~~~0.0.1.0

# 3. Start the SSH service
Start-Service sshd

# 4. Set SSH to start automatically on boot
Set-Service -Name sshd -StartupType 'Automatic'

# 5. Confirm firewall rule exists (should be auto-created)
Get-NetFirewallRule -Name *ssh*

# 6. If no firewall rule, create one:
New-NetFirewallRule -Name sshd -DisplayName 'OpenSSH Server (sshd)' -Enabled True -Direction Inbound -Protocol TCP -Action Allow -LocalPort 22

# 7. Get the IP address to provide:
Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.InterfaceAlias -notlike '*Loopback*' } | Select-Object IPAddress, InterfaceAlias
```

---

## SSH Connection Details (Fill in when ready)

- **IP Address:** ________________
- **Username:** ________________ (Windows username on remote laptop)
- **Password:** ________________ (Windows password)
- **Bcline Path:** ________________

---

## Connection Command (for Copilot to use)

```powershell
# Once details are provided, connect with:
ssh <username>@<ip_address>

# Test connection first:
ssh <username>@<ip_address> "hostname"

# Then run fix commands
```

---

## Verification Checklist

After fixes, verify:

- [ ] `where.exe ffmpeg` returns a valid path
- [ ] `webview-ui\build\assets\index.js` exists
- [ ] `webview-ui\build\assets\index.css` exists  
- [ ] VS Code has a FOLDER open (not just files)
- [ ] Output panel shows "Message Queue Service initialized"
- [ ] Cline UI matches the UI on primary laptop
- [ ] Voice recording works (microphone icon in Cline)
- [ ] `copilot-to-cline.txt` messages are processed

---

## Notes

- The VSIX does NOT bundle FFmpeg - it must be installed separately on each machine
- MessageQueueService requires an open workspace folder to initialize
- Webview must be built BEFORE packaging VSIX (`npm run build:webview`)
- The `vscode:prepublish` script should handle this, but manual rebuild may be needed

---

**When ready to connect, provide SSH details and I'll execute these fixes remotely.**
