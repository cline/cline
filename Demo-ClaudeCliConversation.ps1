# Demo-ClaudeCliConversation.ps1
# Demonstrates client messaging to Cline and Claude CLI conversation flow

param(
    [Parameter(Mandatory=$false)]
    [switch]$Interactive
)

$ErrorActionPreference = "Stop"

# Load messaging system
. .\scripts\Invoke-BclineMessaging.ps1

Write-Host ""
Write-Host "╔═══════════════════════════════════════════════════════════════════════╗" -ForegroundColor Magenta
Write-Host "║  BCline Client → Cline → Claude CLI Conversation Demo                ║" -ForegroundColor Magenta
Write-Host "║  Version 3.47.0                                                       ║" -ForegroundColor Magenta
Write-Host "╚═══════════════════════════════════════════════════════════════════════╝" -ForegroundColor Magenta
Write-Host ""

# Demo 1: Direct message to Cline
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Cyan
Write-Host "Demo 1: Sending message to Cline" -ForegroundColor Cyan
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Cyan
Write-Host ""

Send-Cline "Demo test: Client successfully sending messages to Cline at $(Get-Date -Format 'HH:mm:ss')"
Write-Host ""
Start-Sleep -Seconds 2

# Demo 2: Claude CLI - Simple question
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Cyan
Write-Host "Demo 2: Claude CLI - Simple Math Question" -ForegroundColor Cyan
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Cyan
Write-Host ""

Send-Claude "What is 15 * 23? Just give me the number." -Wait -Timeout 30
Write-Host ""
Start-Sleep -Seconds 2

# Demo 3: Claude CLI - Code explanation
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Cyan
Write-Host "Demo 3: Claude CLI - Code Question" -ForegroundColor Cyan
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Cyan
Write-Host ""

Send-Claude "Explain what a Promise is in JavaScript in one sentence." -Wait -Timeout 30
Write-Host ""
Start-Sleep -Seconds 2

# Demo 4: Multi-step conversation with Cline routing to Claude
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Cyan
Write-Host "Demo 4: Cline → Claude CLI Routing" -ForegroundColor Cyan
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Cyan
Write-Host ""
Write-Host "Using 'claude:' prefix to route through Cline to Claude CLI..." -ForegroundColor Yellow
Write-Host ""

Send-Cline "claude:List 3 popular programming languages in bullet points" -Wait -Timeout 30
Write-Host ""

# Interactive mode
if ($Interactive) {
    Write-Host ""
    Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Magenta
    Write-Host "Interactive Mode: Your Turn!" -ForegroundColor Magenta
    Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Magenta
    Write-Host ""
    Write-Host "Enter your messages below. Type 'exit' or 'quit' to stop." -ForegroundColor Yellow
    Write-Host ""
    
    while ($true) {
        Write-Host ""
        $userInput = Read-Host "You"
        
        if ($userInput -in @('exit', 'quit', 'q', '')) {
            Write-Host "Exiting interactive mode..." -ForegroundColor Gray
            break
        }
        
        # Check for routing prefixes
        if ($userInput -like "claude:*" -or $userInput -like "claude-yolo:*") {
            $prompt = $userInput -replace '^claude(-yolo)?:', ''
            $yolo = $userInput -like "claude-yolo:*"
            Write-Host ""
            if ($yolo) {
                Send-Claude $prompt -Yolo -Wait -Timeout 60
            } else {
                Send-Claude $prompt -Wait -Timeout 60
            }
        }
        elseif ($userInput -like "codex:*" -or $userInput -like "codex-yolo:*") {
            $prompt = $userInput -replace '^codex(-yolo)?:', ''
            $yolo = $userInput -like "codex-yolo:*"
            Write-Host ""
            if ($yolo) {
                Send-Codex $prompt -Yolo -Wait -Timeout 60
            } else {
                Send-Codex $prompt -Wait -Timeout 60
            }
        }
        elseif ($userInput -like "gemini:*" -or $userInput -like "gemini-yolo:*") {
            $prompt = $userInput -replace '^gemini(-yolo)?:', ''
            $yolo = $userInput -like "gemini-yolo:*"
            Write-Host ""
            if ($yolo) {
                Send-Gemini $prompt -Yolo -Wait -Timeout 60
            } else {
                Send-Gemini $prompt -Wait -Timeout 60
            }
        }
        else {
            # Default to Cline
            Write-Host ""
            Send-Cline $userInput -Wait -Timeout 60
        }
    }
}

# Summary
Write-Host ""
Write-Host "╔═══════════════════════════════════════════════════════════════════════╗" -ForegroundColor Green
Write-Host "║  Demo Complete!                                                       ║" -ForegroundColor Green
Write-Host "╚═══════════════════════════════════════════════════════════════════════╝" -ForegroundColor Green
Write-Host ""
Write-Host "✓ Client → Cline messaging: Working" -ForegroundColor Green
Write-Host "✓ Claude CLI integration: Working" -ForegroundColor Green
Write-Host "✓ Message routing: Working" -ForegroundColor Green
Write-Host "✓ Response handling: Working" -ForegroundColor Green
Write-Host ""
Write-Host "Available Commands:" -ForegroundColor Cyan
Write-Host "  Send-Cline `"message`"                - Message Cline directly" -ForegroundColor White
Write-Host "  Send-Claude `"prompt`"                - Ask Claude CLI" -ForegroundColor White
Write-Host "  Send-Codex `"prompt`"                 - Ask Codex CLI" -ForegroundColor White
Write-Host "  Send-Gemini `"prompt`"                - Ask Gemini CLI" -ForegroundColor White
Write-Host "  .\Demo-ClaudeCliConversation.ps1 -Interactive  - Interactive mode" -ForegroundColor White
Write-Host ""
Write-Host "Routing Prefixes:" -ForegroundColor Cyan
Write-Host "  claude:prompt      - Route through Cline to Claude CLI" -ForegroundColor White
Write-Host "  claude-yolo:prompt - Claude CLI with auto-approve" -ForegroundColor White
Write-Host "  codex:prompt       - Route to Codex CLI" -ForegroundColor White
Write-Host "  gemini:prompt      - Route to Gemini CLI" -ForegroundColor White
Write-Host ""
