# Invoke-BclineMessaging.ps1
# Global trigger for BCline messaging system - works from ANY directory
# Usage: bcline-activate or Invoke-BclineMessaging

# BCline installation path - UPDATE THIS if you move BCline
$script:BclineRoot = "C:\Users\bob43\Downloads\Bcline"

function Get-BclineRoot {
    return $script:BclineRoot
}

function Set-BclineRoot {
    param([string]$Path)
    $script:BclineRoot = $Path
    Write-Host "BCline root set to: $Path" -ForegroundColor Green
}

function Invoke-BclineMessaging {
    <#
    .SYNOPSIS
    Activates BCline messaging context from any directory.
    
    .DESCRIPTION
    Outputs the messaging system documentation and makes all BCline
    messaging commands available regardless of current directory.
    
    .EXAMPLE
    bcline-activate
    #>
    
    Write-Host ""
    Write-Host "═══════════════════════════════════════════════════════════════════════" -ForegroundColor Cyan
    Write-Host "  BCLINE MESSAGING SYSTEM ACTIVATED" -ForegroundColor Cyan
    Write-Host "═══════════════════════════════════════════════════════════════════════" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "BCline Root: $script:BclineRoot" -ForegroundColor Gray
    Write-Host "Current Dir: $(Get-Location)" -ForegroundColor Gray
    Write-Host ""
    
    # Output the messaging system context for Copilot to understand
    $contextDoc = @"
## BCline CLI Messaging System - Quick Reference

**Installation Path:** $script:BclineRoot

### Available Commands (work from ANY directory):

| Command | Description |
|---------|-------------|
| ``Send-Cline "message"`` | Send message to Cline |
| ``Send-Cline "message" -Wait`` | Send and wait for response |
| ``Send-Claude "prompt"`` | Send to Claude CLI (Opus 4.5) |
| ``Send-Codex "prompt"`` | Send to Codex CLI (GPT-5.1) |
| ``Send-Gemini "prompt"`` | Send to Gemini CLI |
| ``Cline-AutoApprove`` | Enable all auto-approvals |
| ``Cline-SetModel "model"`` | Switch OpenRouter model |
| ``Cline-Usage`` | Get token usage/cost |

### Prefixes (via Send-Cline):
- ``claude:prompt`` - Route to Claude CLI
- ``codex:prompt`` - Route to Codex CLI  
- ``gemini:prompt`` - Route to Gemini CLI
- ``claude-yolo:prompt`` - Claude with auto-approve
- ``codex-yolo:prompt`` - Codex with full agent mode
- ``gemini-yolo:prompt`` - Gemini with YOLO mode

### Special Commands:
- ``set-model:anthropic/claude-sonnet-4`` - Switch model
- ``auto-approve-all`` or ``yolo-mode`` - Enable all approvals
- ``get-usage`` - Check token usage

### Architecture:
```
Copilot (You) → Send-Cline → BCline Extension → Target CLI
                    ↓
            .message-queue/
            ├── inbox/      (messages TO Cline)
            ├── responses/  (responses FROM Cline)
            └── outbox/     (notifications)
```

### Examples:
```powershell
# Simple task to Cline
Send-Cline "Create a hello world script"

# Ask Claude CLI directly
Send-Claude "Explain async/await in JavaScript"

# Full auto mode then task
Cline-AutoApprove
Send-Cline "Refactor the auth module"
```
"@
    
    Write-Host $contextDoc
    Write-Host ""
    Write-Host "═══════════════════════════════════════════════════════════════════════" -ForegroundColor Green
    Write-Host "  READY - Use commands above from any directory" -ForegroundColor Green
    Write-Host "═══════════════════════════════════════════════════════════════════════" -ForegroundColor Green
    Write-Host ""
}

# Wrapper functions that work from any directory
function Send-Cline {
    param(
        [Parameter(Mandatory=$true, Position=0)]
        [string]$Message,
        
        [switch]$Wait,
        
        [int]$Timeout = 60
    )
    
    $script = Join-Path $script:BclineRoot "Send-ClineMessage.ps1"
    
    if (-not (Test-Path $script)) {
        Write-Error "BCline not found at $script:BclineRoot. Use Set-BclineRoot to update."
        return
    }
    
    $params = @{
        Message = $Message
    }
    if ($Wait) { $params.Wait = $true }
    if ($Timeout -ne 60) { $params.Timeout = $Timeout }
    
    & $script @params
}

function Send-Claude {
    param(
        [Parameter(Mandatory=$true, Position=0)]
        [string]$Prompt,
        
        [switch]$Yolo,
        
        [switch]$Wait,
        
        [int]$Timeout = 120
    )
    
    $prefix = if ($Yolo) { "claude-yolo:" } else { "claude:" }
    Send-Cline -Message "$prefix$Prompt" -Wait:$Wait -Timeout $Timeout
}

function Send-Codex {
    param(
        [Parameter(Mandatory=$true, Position=0)]
        [string]$Prompt,
        
        [switch]$Yolo,
        
        [switch]$Wait,
        
        [int]$Timeout = 120
    )
    
    $prefix = if ($Yolo) { "codex-yolo:" } else { "codex:" }
    Send-Cline -Message "$prefix$Prompt" -Wait:$Wait -Timeout $Timeout
}

function Send-Gemini {
    param(
        [Parameter(Mandatory=$true, Position=0)]
        [string]$Prompt,
        
        [switch]$Yolo,
        
        [switch]$Wait,
        
        [int]$Timeout = 120
    )
    
    $prefix = if ($Yolo) { "gemini-yolo:" } else { "gemini:" }
    Send-Cline -Message "$prefix$Prompt" -Wait:$Wait -Timeout $Timeout
}

function Cline-AutoApprove {
    Send-Cline -Message "auto-approve-all"
}

function Cline-SetModel {
    param(
        [Parameter(Mandatory=$true, Position=0)]
        [string]$Model
    )
    Send-Cline -Message "set-model:$Model"
}

function Cline-Usage {
    Send-Cline -Message "get-usage" -Wait -Timeout 10
}

function Cline-Help {
    <#
    .SYNOPSIS
    Display BCline messaging system help.
    
    .DESCRIPTION
    Shows all available commands, prefixes, and usage examples
    for the BCline messaging system.
    #>
    
    $helpText = @"

╔══════════════════════════════════════════════════════════════════════╗
║              BCLINE MESSAGING SYSTEM - HELP                          ║
╚══════════════════════════════════════════════════════════════════════╝

📋 POWERSHELL COMMANDS (work from ANY directory):
  Send-Cline "message"        Send message to Cline
  Send-Cline "msg" -Wait      Send and wait for response
  Send-Claude "prompt"        Send to Claude CLI (Opus 4.5)
  Send-Claude "p" -Yolo       Claude CLI with auto-approve
  Send-Codex "prompt"         Send to Codex CLI (GPT-5.1)
  Send-Codex "p" -Yolo        Codex CLI with full agent mode
  Send-Gemini "prompt"        Send to Gemini CLI
  Send-Gemini "p" -Yolo       Gemini CLI with YOLO mode
  Cline-AutoApprove           Enable all auto-approvals
  Cline-SetModel "model"      Switch OpenRouter model
  Cline-Usage                 Get token usage and cost
  Cline-Help                  Show this help

⚡ SHORT ALIASES:
  sc "message"                Send-Cline
  scl "prompt"                Send-Claude
  scx "prompt"                Send-Codex
  sgm "prompt"                Send-Gemini
  bcline                      Show context/activate

🤖 MESSAGE PREFIXES (via Send-Cline):
  claude:<prompt>             Route to Claude CLI
  claude-yolo:<prompt>        Claude with auto-approve
  codex:<prompt>              Route to Codex CLI (read-only)
  codex-yolo:<prompt>         Codex with full agent mode
  gemini:<prompt>             Route to Gemini CLI
  gemini-yolo:<prompt>        Gemini with YOLO mode

🔧 SPECIAL COMMANDS (via Send-Cline):
  help                        Get help from Cline
  get-usage                   Get token usage
  auto-approve-all            Enable all approvals
  yolo-mode                   Alias for auto-approve-all
  set-model:<model-id>        Switch model

🔗 ORCHESTRATION (via Send-Cline):
  pipeline: claude->codex: prompt     Chain agents
  parallel: claude+codex: prompt      Run in parallel

📁 PATHS:
  BCline Root: $script:BclineRoot
  Message Queue: $script:BclineRoot\.message-queue\

📚 DOCUMENTATION:
  CLI_MESSAGING.md            Full system documentation
  BCLINE_MESSAGING_CONTEXT.md Quick reference

"@
    Write-Host $helpText
}

# Aliases for quick access
Set-Alias -Name bcline-activate -Value Invoke-BclineMessaging -Scope Global
Set-Alias -Name bcline -Value Invoke-BclineMessaging -Scope Global
Set-Alias -Name sc -Value Send-Cline -Scope Global
Set-Alias -Name scl -Value Send-Claude -Scope Global
Set-Alias -Name scx -Value Send-Codex -Scope Global
Set-Alias -Name sgm -Value Send-Gemini -Scope Global
Set-Alias -Name chelp -Value Cline-Help -Scope Global

# Export functions (only when loaded as a module)
if ($MyInvocation.MyCommand.ScriptBlock.Module) {
    Export-ModuleMember -Function * -Alias *
}

Write-Host "✅ BCline Messaging loaded! Type 'Cline-Help' or 'chelp' for help." -ForegroundColor Green
