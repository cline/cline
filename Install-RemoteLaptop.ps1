#!/usr/bin/env pwsh
# Install-RemoteLaptop.ps1
# Automated installation script for remote laptop setup
# Run as Administrator!

Write-Host "╔═══════════════════════════════════════════════════════════════════╗" -ForegroundColor Cyan
Write-Host "║  REMOTE LAPTOP - BCLINE SETUP SCRIPT                             ║" -ForegroundColor Cyan
Write-Host "╚═══════════════════════════════════════════════════════════════════╝" -ForegroundColor Cyan
Write-Host ""

# Check admin privileges
$isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole] "Administrator")
if (-not $isAdmin) {
    Write-Host "⚠ WARNING: Not running as Administrator" -ForegroundColor Yellow
    Write-Host "   Some installations may require admin rights." -ForegroundColor Gray
    Write-Host "   Consider right-clicking and selecting 'Run as Administrator'" -ForegroundColor Gray
    Write-Host ""
    $continue = Read-Host "Continue anyway? (y/n)"
    if ($continue -ne 'y') { exit }
}

# Step 1: Install winget packages
Write-Host "📦 STEP 1: Installing Winget Packages..." -ForegroundColor Yellow
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Gray

$wingetPackages = @(
    "Git.Git",
    "Microsoft.VisualStudioCode",
    "OpenJS.NodeJS",
    "Gyan.FFmpeg",
    "Python.Python.3.12"
)

foreach ($pkg in $wingetPackages) {
    Write-Host "   Installing: $pkg" -ForegroundColor Cyan
    try {
        winget install $pkg -e --accept-package-agreements --accept-source-agreements 2>$null
        Write-Host "   ✓ $pkg installed" -ForegroundColor Green
    } catch {
        Write-Host "   ✗ $pkg failed or already installed" -ForegroundColor Red
    }
}

Write-Host ""

# Step 2: Install npm global packages
Write-Host "📦 STEP 2: Installing NPM Global Packages..." -ForegroundColor Yellow
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Gray

$npmPackages = @(
    "@anthropic-ai/claude-code",
    "@openai/codex",
    "gemini-cli"
)

foreach ($pkg in $npmPackages) {
    Write-Host "   Installing: $pkg" -ForegroundColor Cyan
    try {
        npm install -g $pkg 2>&1 | Out-Null
        Write-Host "   ✓ $pkg installed" -ForegroundColor Green
    } catch {
        Write-Host "   ✗ $pkg failed" -ForegroundColor Red
    }
}

Write-Host ""

# Step 3: Verify installations
Write-Host "🔍 STEP 3: Verifying Installations..." -ForegroundColor Yellow
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Gray

$tools = @(
    @{ Name = "Git"; Cmd = "git --version" },
    @{ Name = "VS Code"; Cmd = "code --version" },
    @{ Name = "Node.js"; Cmd = "node --version" },
    @{ Name = "NPM"; Cmd = "npm --version" },
    @{ Name = "Python"; Cmd = "py --version" },
    @{ Name = "FFmpeg"; Cmd = "ffmpeg -version" },
    @{ Name = "Claude CLI"; Cmd = "claude --version" },
    @{ Name = "Codex CLI"; Cmd = "codex --version" },
    @{ Name = "Gemini CLI"; Cmd = "gemini --version" }
)

foreach ($tool in $tools) {
    try {
        $result = Invoke-Expression $tool.Cmd 2>$null
        if ($result) {
            Write-Host "   ✓ $($tool.Name): $result" -ForegroundColor Green
        } else {
            Write-Host "   ✗ $($tool.Name): Not found" -ForegroundColor Red
        }
    } catch {
        Write-Host "   ✗ $($tool.Name): Error" -ForegroundColor Red
    }
}

Write-Host ""

# Step 4: Next steps
Write-Host "📋 STEP 4: NEXT STEPS..." -ForegroundColor Yellow
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Gray
Write-Host ""
Write-Host "   1. Install VSIX Extension:" -ForegroundColor White
Write-Host "      - Open VS Code" -ForegroundColor Gray
Write-Host "      - Ctrl+Shift+P → 'Extensions: Install from VSIX'" -ForegroundColor Gray
Write-Host "      - Select: builds/claude-dev-*.vsix" -ForegroundColor Gray
Write-Host ""
Write-Host "   2. Configure API Keys in Cline Settings" -ForegroundColor White
Write-Host "      - Open Cline sidebar → Settings" -ForegroundColor Gray
Write-Host "      - Add OpenRouter/Anthropic API key" -ForegroundColor Gray
Write-Host ""
Write-Host "   3. Install GitHub Copilot:" -ForegroundColor White
Write-Host "      - VS Code Extensions" -ForegroundColor Gray
Write-Host "      - Install 'GitHub Copilot' and 'GitHub Copilot Chat'" -ForegroundColor Gray
Write-Host ""
Write-Host "   4. Sign into GitHub in VS Code" -ForegroundColor White
Write-Host ""
Write-Host "   5. Enable Dictation (optional):" -ForegroundColor White
Write-Host "      - Cline Settings → Features → Dictation" -ForegroundColor Gray
Write-Host "      - Toggle ON" -ForegroundColor Gray
Write-Host ""
Write-Host "   6. Enable Voice Input (optional):" -ForegroundColor White
Write-Host "      - Cline Settings → Account → Sign in" -ForegroundColor Gray
Write-Host ""

Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Gray
Write-Host ""
Write-Host "✅ SETUP COMPLETE!" -ForegroundColor Green
Write-Host ""
Write-Host "   Next, copy these files to your project folder:" -ForegroundColor White
Write-Host "   - Send-ClineMessage.ps1" -ForegroundColor Gray
Write-Host "   - Set-ClineModel.ps1" -ForegroundColor Gray
Write-Host "   - CLI_MESSAGING.md" -ForegroundColor Gray
Write-Host ""
Write-Host "   And run these commands daily:" -ForegroundColor White
Write-Host "   .\Send-ClineMessage.ps1 -Message 'auto-approve-all'" -ForegroundColor Cyan
Write-Host ""

# Ask if user wants to open the builds folder
$openBuilds = Read-Host "Open builds folder to install VSIX? (y/n)"
if ($openBuilds -eq 'y') {
    $buildsPath = Join-Path (Get-Location) "builds"
    if (Test-Path $buildsPath) {
        explorer.exe $buildsPath
    } else {
        Write-Host "   ⚠ builds folder not found in current directory" -ForegroundColor Yellow
        Write-Host "   Copy VSIX from USB drive manually" -ForegroundColor Gray
    }
}

Write-Host ""
Write-Host "════════════════════════════════════════════════════════════════════" -ForegroundColor Gray
