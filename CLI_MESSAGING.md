# BCline CLI Messaging System

A bidirectional file-based messaging system that enables external processes (like GitHub Copilot) to communicate with BCline and Claude CLI.

## Overview

The messaging system uses file-based communication through the `.message-queue/` directory:
- `inbox/` - Messages TO Cline
- `responses/` - Responses FROM Cline  
- `outbox/` - Notifications FROM Cline

## Architecture

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────┐     ┌─────────────┐
│ GitHub Copilot  │────▶│ Send-ClineMessage│────▶│   BCline    │────▶│ Claude CLI  │
│  (Voice Input)  │     │     .ps1         │     │ Extension   │     │  (Opus 4.5) │
└─────────────────┘     └──────────────────┘     └─────────────┘     └─────────────┘
        │                                               │
        │                                               ▼
        │                                      ┌─────────────────┐
        └─────────────────────────────────────▶│ MessageQueue    │
                                               │ Service.ts      │
                                               └─────────────────┘
```

**Three AI Channels:**
1. **Copilot** - Voice/chat in VS Code (Claude Opus 4.5 Preview)
2. **Cline** - Via `Send-ClineMessage.ps1` (OpenRouter models)
3. **Claude CLI** - Via `claude:` prefix (Claude Opus 4.5)

## Quick Start

### Send a message to Cline:
```powershell
.\Send-ClineMessage.ps1 -Message "Create a Python hello world script"
```

### Send and wait for response:
```powershell
.\Send-ClineMessage.ps1 -Message "What is 2 + 2?" -Wait -Timeout 60
```

### Send to Claude CLI (via Cline):
```powershell
.\Send-ClineMessage.ps1 -Message "claude:Explain recursion in simple terms"
```

## CLI Scripts

| Script | Description |
|--------|-------------|
| `Send-ClineMessage.ps1` | Send messages to Cline, optionally wait for response |
| `Set-ClineModel.ps1` | Helper to switch OpenRouter models |
| `send-program.ps1` | Send a file's contents as a task to Cline |

## Special Commands

These commands are handled directly by the MessageQueueService:

### Cline Commands
| Command | Description |
|---------|-------------|
| `set-model:<model-id>` | Switch the OpenRouter model (e.g., `set-model:anthropic/claude-sonnet-4`) |
| `get-usage` | Get token usage and cost for current task |
| `get-tokens` | Alias for get-usage |
| `get-cost` | Alias for get-usage |
| `enable-all-commands` | Enable auto-approval for ALL terminal commands (including PowerShell) |
| `yolo-commands` | Alias for enable-all-commands |
| `auto-approve-all` | Enable FULL auto-approval (read, edit, commands, browser, MCP) |
| `yolo-mode` | Alias for auto-approve-all |

### Claude CLI Commands
| Command | Description |
|---------|-------------|
| `claude:<prompt>` | Send prompt to Claude CLI and return response |
| `claude-yolo:<prompt>` | Send prompt to Claude CLI with auto-approve (bypassPermissions) |

## Examples

### Switch Cline to Claude Sonnet 4:
```powershell
.\Send-ClineMessage.ps1 -Message "set-model:anthropic/claude-sonnet-4"
```

### Check token usage:
```powershell
.\Send-ClineMessage.ps1 -Message "get-usage" -Wait -Timeout 10
```

Example response:
```
Usage Report | Model: anthropic/claude-sonnet-4 | Tokens In: 18,502 | Tokens Out: 382 | Cache: W0/R0 | Cost: $0.0751
```

### Enable all auto-approvals:
```powershell
.\Send-ClineMessage.ps1 -Message "auto-approve-all"
```

### Send to Claude CLI:
```powershell
.\Send-ClineMessage.ps1 -Message "claude:What is the capital of France?" -Wait -Timeout 30
```

### Send to Claude CLI with auto-approve:
```powershell
.\Send-ClineMessage.ps1 -Message "claude-yolo:Create a file called hello.py that prints Hello World"
```

## Voice Workflow (Copilot → Cline → Claude CLI)

With this system, you can use voice input through GitHub Copilot to orchestrate multiple AI agents:

1. **Speak to Copilot** (using voice input)
2. **Copilot runs commands** via `Send-ClineMessage.ps1`
3. **Cline receives and processes** the message
4. **Claude CLI executes** if using `claude:` prefix
5. **Response flows back** through the chain

Example voice command:
> "Send to Claude: explain how async await works in JavaScript"

Copilot translates this to:
```powershell
.\Send-ClineMessage.ps1 -Message "claude:explain how async await works in JavaScript" -Wait
```

## Message Format

Messages are JSON files with this structure:
```json
{
  "id": "unique-uuid",
  "from": "claude-code",
  "to": "cline",
  "timestamp": "2025-12-05T07:30:00.000Z",
  "type": "command",
  "content": "Your message here",
  "metadata": {}
}
```

## Claude CLI Direct Usage

You can also use Claude CLI directly from terminal:

```powershell
# Simple prompt
claude -p "Your prompt here`n"

# With auto-approve
claude --permission-mode bypassPermissions -p "Create a file...`n"

# Check version
claude --version
```

## Requirements

- PowerShell 5.1+ or PowerShell Core 7+
- BCline VS Code extension v3.40.0+
- VS Code with the extension loaded
- Claude CLI (`npm install -g @anthropic-ai/claude-code`) for claude: commands
