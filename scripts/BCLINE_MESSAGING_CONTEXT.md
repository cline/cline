# BCline Messaging System - Copilot Context
# This file provides context for GitHub Copilot when working with BCline messaging from any directory

## What is This?

BCline is a VS Code extension that provides a messaging system allowing external processes 
(like GitHub Copilot) to communicate with multiple AI agents:

- **Cline** (BCline Extension) - Via OpenRouter API
- **Claude CLI** - Anthropic's Claude Opus 4.5
- **Codex CLI** - OpenAI's GPT-5.1-codex-max  
- **Gemini CLI** - Google's Gemini

## Installation Location

BCline is installed at: `C:\Users\bob43\Downloads\Bcline`

## How to Use from Any Directory

After the trigger is activated, these commands work globally:

### Core Commands

```powershell
# Send a task to Cline (BCline extension)
Send-Cline "Your task here"
Send-Cline "Your task" -Wait -Timeout 60

# Send directly to Claude CLI
Send-Claude "Your prompt"
Send-Claude "Your prompt" -Yolo  # With auto-approve

# Send directly to Codex CLI  
Send-Codex "Your prompt"
Send-Codex "Your prompt" -Yolo  # Bypass sandbox

# Send directly to Gemini CLI
Send-Gemini "Your prompt"
Send-Gemini "Your prompt" -Yolo  # YOLO mode

# Setup commands
Cline-AutoApprove              # Enable all auto-approvals
Cline-SetModel "model-id"      # Switch OpenRouter model
Cline-Usage                    # Get token usage/cost
```

### Short Aliases

```powershell
sc "message"     # Send-Cline
scl "prompt"     # Send-Claude
scx "prompt"     # Send-Codex
sgm "prompt"     # Send-Gemini
bcline           # Show help/activate context
```

### Message Prefixes (via Send-Cline)

When using Send-Cline, you can prefix messages to route to specific CLIs:

| Prefix | Routes To | Mode |
|--------|-----------|------|
| `claude:` | Claude CLI | Normal |
| `claude-yolo:` | Claude CLI | Auto-approve |
| `codex:` | Codex CLI | Read-only |
| `codex-yolo:` | Codex CLI | Full agent |
| `gemini:` | Gemini CLI | Normal |
| `gemini-yolo:` | Gemini CLI | YOLO |

### Special Commands

| Command | Description |
|---------|-------------|
| `set-model:<model-id>` | Switch OpenRouter model |
| `get-usage` | Get token usage and cost |
| `auto-approve-all` | Enable all auto-approvals |
| `yolo-mode` | Alias for auto-approve-all |
| `enable-all-commands` | Enable terminal command approval |

### Example Workflows

**Simple task:**
```powershell
Send-Cline "Create a Python script that calculates fibonacci numbers"
```

**Ask Claude for explanation:**
```powershell
Send-Claude "Explain the difference between async and parallel programming"
```

**Full automation workflow:**
```powershell
Cline-AutoApprove
Cline-SetModel "anthropic/claude-sonnet-4"
Send-Cline "Refactor the authentication module to use JWT tokens"
```

**Quick task with Codex:**
```powershell
scx "Write a binary search algorithm in Rust"
```

## Message Queue Location

Messages are stored in `.message-queue/` directory at BCline root:

```
C:\Users\bob43\Downloads\Bcline\.message-queue\
├── inbox/      # Messages TO Cline (you write here)
├── responses/  # Responses FROM Cline (Cline writes here)
└── outbox/     # Notifications FROM Cline
```

## Requirements

- PowerShell 5.1+ or PowerShell Core 7+
- BCline VS Code extension running
- Claude CLI: `npm install -g @anthropic-ai/claude-code`
- Codex CLI: `npm install -g @openai/codex`
- Gemini CLI: `npm install -g gemini-cli`

## Rules for AI Assistants (Copilot, Claude, etc.)

When executing terminal commands in this workspace:

1. **Run commands DIRECTLY in PowerShell** - Never invoke AI CLI wrappers like `claude`, `codex`, or `gemini` commands when you already have terminal access
2. **Use native tools** - Run `npm`, `git`, `node`, PowerShell cmdlets, etc. directly
3. **No nested AI invocation** - If you ARE an AI assistant with terminal access, do NOT spawn another AI CLI to do work. Execute the commands yourself.
4. **The Claude/Codex/Gemini CLIs are for humans** - Those CLI tools are meant for users to invoke AI agents. An AI assistant should not call another AI through CLI.

**Example - WRONG:**
```powershell
claude "fix the bug in auth.ts"   # Don't do this - you're already an AI!
```

**Example - CORRECT:**
```powershell
# Just run the actual commands directly:
npm run build
git status
Get-Content .\src\auth.ts
```

## Troubleshooting

**Commands not found:**
```powershell
# Re-load the messaging module
. "C:\Users\bob43\Downloads\Bcline\scripts\Invoke-BclineMessaging.ps1"
```

**BCline path changed:**
```powershell
Set-BclineRoot "C:\new\path\to\Bcline"
```

**Task stuck waiting:**
```powershell
Cline-AutoApprove  # Enable auto-approvals
```
