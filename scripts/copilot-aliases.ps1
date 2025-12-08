# Add these to your PowerShell profile ($PROFILE) for quick access
# Or dot-source this file: . .\scripts\copilot-aliases.ps1

# Quick task - uses Haiku (cheap, fast)
function cq { 
    param([Parameter(ValueFromRemainingArguments=$true)]$args)
    copilot -p "$args" --model claude-haiku-4.5 
}

# Balanced task - uses Sonnet (1x cost)
function cb { 
    param([Parameter(ValueFromRemainingArguments=$true)]$args)
    copilot -p "$args" --model claude-sonnet-4.5 
}

# Complex task - uses Opus (3x cost, best quality)
function co { 
    param([Parameter(ValueFromRemainingArguments=$true)]$args)
    copilot -p "$args" --model claude-opus-4.5 
}

# Silent versions (just output, no stats)
function cqs { 
    param([Parameter(ValueFromRemainingArguments=$true)]$args)
    copilot -p "$args" --model claude-haiku-4.5 -s
}
function cbs { 
    param([Parameter(ValueFromRemainingArguments=$true)]$args)
    copilot -p "$args" --model claude-sonnet-4.5 -s
}
function cos { 
    param([Parameter(ValueFromRemainingArguments=$true)]$args)
    copilot -p "$args" --model claude-opus-4.5 -s
}

# Interactive mode shortcuts
function cqi { copilot --model claude-haiku-4.5 }
function cbi { copilot --model claude-sonnet-4.5 }
function coi { copilot --model claude-opus-4.5 }

# Fetch and fix bug helper
function Fix-Bug {
    param(
        [Parameter(Mandatory=$true)][string]$IssueNumber,
        [ValidateSet("haiku", "sonnet", "opus")][string]$Model = "opus"
    )
    
    $modelId = switch ($Model) {
        "haiku" { "claude-haiku-4.5" }
        "sonnet" { "claude-sonnet-4.5" }
        "opus" { "claude-opus-4.5" }
    }
    
    Write-Host "🐛 Fetching and fixing bug #$IssueNumber with $Model..." -ForegroundColor Cyan
    copilot -p "Use the GitHub MCP server to fetch issue #$IssueNumber from cline/cline repo. Analyze the bug and implement a fix in this codebase." --model $modelId
}

# Analyze codebase helper
function Analyze-Code {
    param(
        [string]$Query = "Analyze the codebase architecture and key components",
        [ValidateSet("haiku", "sonnet", "opus")][string]$Model = "sonnet"
    )
    
    $modelId = switch ($Model) {
        "haiku" { "claude-haiku-4.5" }
        "sonnet" { "claude-sonnet-4.5" }
        "opus" { "claude-opus-4.5" }
    }
    
    copilot -p $Query --model $modelId
}

Write-Host "✅ Copilot aliases loaded!" -ForegroundColor Green
Write-Host "  cq/cb/co  - Quick/Balanced/Complex prompts (haiku/sonnet/opus)" -ForegroundColor Gray
Write-Host "  cqi/cbi/coi - Interactive mode with each model" -ForegroundColor Gray
Write-Host "  Fix-Bug -IssueNumber 7974 - Fetch and fix a bug" -ForegroundColor Gray
