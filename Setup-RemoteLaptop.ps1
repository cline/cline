# Setup-RemoteLaptop.ps1
# Run this script ON THE REMOTE LAPTOP to:
# 1. Display IP address
# 2. Set up OpenSSH Server (if needed)
# 3. Check/fix dependencies

Write-Host "╔═══════════════════════════════════════════════════════════════════╗" -ForegroundColor Cyan
Write-Host "║  REMOTE LAPTOP SETUP SCRIPT                                       ║" -ForegroundColor Cyan
Write-Host "╚═══════════════════════════════════════════════════════════════════╝" -ForegroundColor Cyan
Write-Host ""

# Step 1: Show IP Address
Write-Host "📍 YOUR IP ADDRESS:" -ForegroundColor Yellow
$wifiIP = (Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.InterfaceAlias -match "Wi-Fi" -and $_.IPAddress -notmatch "^169" }).IPAddress
$ethernetIP = (Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.InterfaceAlias -match "Ethernet" -and $_.IPAddress -notmatch "^169" }).IPAddress

if ($wifiIP) {
    Write-Host "   Wi-Fi IP: $wifiIP" -ForegroundColor Green
}
if ($ethernetIP) {
    Write-Host "   Ethernet IP: $ethernetIP" -ForegroundColor Green
}
if (-not $wifiIP -and -not $ethernetIP) {
    ipconfig | Select-String "IPv4"
}

Write-Host ""
Write-Host "════════════════════════════════════════════════════════════════════" -ForegroundColor Gray

# Step 2: Check OpenSSH Server
Write-Host ""
Write-Host "🔐 CHECKING OPENSSH SERVER..." -ForegroundColor Yellow
$sshService = Get-Service sshd -ErrorAction SilentlyContinue
if ($sshService) {
    Write-Host "   ✓ OpenSSH Server installed" -ForegroundColor Green
    Write-Host "   Status: $($sshService.Status)" -ForegroundColor Cyan
    if ($sshService.Status -ne "Running") {
        Write-Host "   Starting SSH service..." -ForegroundColor Yellow
        Start-Service sshd -ErrorAction SilentlyContinue
        Set-Service sshd -StartupType Automatic -ErrorAction SilentlyContinue
        Write-Host "   ✓ SSH service started" -ForegroundColor Green
    }
} else {
    Write-Host "   ✗ OpenSSH Server NOT installed" -ForegroundColor Red
    Write-Host ""
    Write-Host "   Installing OpenSSH Server (requires admin)..." -ForegroundColor Yellow
    
    # Check if running as admin
    $isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole] "Administrator")
    
    if ($isAdmin) {
        # Install OpenSSH Server
        Add-WindowsCapability -Online -Name OpenSSH.Server~~~~0.0.1.0
        Start-Service sshd
        Set-Service -Name sshd -StartupType Automatic
        
        # Configure firewall
        if (!(Get-NetFirewallRule -Name "OpenSSH-Server-In-TCP" -ErrorAction SilentlyContinue | Select-Object Name, Enabled)) {
            New-NetFirewallRule -Name 'OpenSSH-Server-In-TCP' -DisplayName 'OpenSSH Server (sshd)' -Enabled True -Direction Inbound -Protocol TCP -Action Allow -LocalPort 22
        }
        Write-Host "   ✓ OpenSSH Server installed and started" -ForegroundColor Green
    } else {
        Write-Host "   ⚠ Please run this script as Administrator to install SSH" -ForegroundColor Red
        Write-Host "   Or install manually: Add-WindowsCapability -Online -Name OpenSSH.Server~~~~0.0.1.0" -ForegroundColor Gray
    }
}

Write-Host ""
Write-Host "════════════════════════════════════════════════════════════════════" -ForegroundColor Gray

# Step 3: Check FFmpeg (for voice)
Write-Host ""
Write-Host "🎤 CHECKING FFMPEG (required for voice)..." -ForegroundColor Yellow
$ffmpegPath = (Get-Command ffmpeg -ErrorAction SilentlyContinue).Source
if ($ffmpegPath) {
    Write-Host "   ✓ FFmpeg installed: $ffmpegPath" -ForegroundColor Green
} else {
    Write-Host "   ✗ FFmpeg NOT installed" -ForegroundColor Red
    Write-Host ""
    Write-Host "   To install FFmpeg:" -ForegroundColor Yellow
    Write-Host "   winget install Gyan.FFmpeg" -ForegroundColor Cyan
    Write-Host ""
    $install = Read-Host "   Install FFmpeg now? (y/n)"
    if ($install -eq 'y') {
        winget install Gyan.FFmpeg --accept-package-agreements --accept-source-agreements
        Write-Host "   ✓ FFmpeg installed. Restart PowerShell to use." -ForegroundColor Green
    }
}

Write-Host ""
Write-Host "════════════════════════════════════════════════════════════════════" -ForegroundColor Gray

# Step 4: Check Bcline/webview
Write-Host ""
Write-Host "📦 CHECKING BCLINE WEBVIEW..." -ForegroundColor Yellow
$bclinePaths = @(
    "C:\Users\$env:USERNAME\Downloads\Bcline",
    "C:\Bcline",
    "D:\Bcline",
    "$env:USERPROFILE\Bcline"
)
foreach ($p in $bclinePaths) {
    if (Test-Path "$p\package.json") {
        Write-Host "   Found Bcline at: $p" -ForegroundColor Cyan
        
        if (Test-Path "$p\webview-ui\build\assets\index.js") {
            Write-Host "   ✓ Webview build exists" -ForegroundColor Green
        } else {
            Write-Host "   ✗ Webview NOT built" -ForegroundColor Red
            Write-Host "   Run: cd '$p\webview-ui'; npm install; npm run build" -ForegroundColor Yellow
        }
        break
    }
}

Write-Host ""
Write-Host "════════════════════════════════════════════════════════════════════" -ForegroundColor Gray
Write-Host ""
Write-Host "📋 SUMMARY - TELL THE MAIN LAPTOP:" -ForegroundColor Green
Write-Host "   1. Your IP Address: $wifiIP$ethernetIP" -ForegroundColor White
Write-Host "   2. Username: $env:USERNAME" -ForegroundColor White
Write-Host ""
Write-Host "   SSH Command from main laptop:" -ForegroundColor Yellow
$ip = if ($wifiIP) { $wifiIP } else { $ethernetIP }
Write-Host "   ssh $env:USERNAME@$ip" -ForegroundColor Cyan
Write-Host ""
