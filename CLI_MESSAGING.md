# BCline CLI Messaging System

A bidirectional file-based messaging system that enables external processes (like GitHub Copilot) to communicate with BCline.

## Overview

The messaging system uses file-based communication through the `.message-queue/` directory:
- `inbox/` - Messages TO Cline
- `responses/` - Responses FROM Cline  
- `outbox/` - Notifications FROM Cline

## Quick Start

### Send a message to Cline:
```powershell
.\Send-ClineMessage.ps1 -Message "Create a Python hello world script"
```

### Send and wait for response:
```powershell
.\Send-ClineMessage.ps1 -Message "What is 2 + 2?" -Wait -Timeout 60
```

## CLI Scripts

| Script | Description |
|--------|-------------|
| `Send-ClineMessage.ps1` | Send messages to Cline, optionally wait for response |
| `Set-ClineModel.ps1` | Helper to switch OpenRouter models |
| `send-program.ps1` | Send a file's contents as a task to Cline |

## Special Commands

These commands are handled directly by the MessageQueueService without starting a Cline task:

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

## Examples

### Switch to Claude Sonnet 4:
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

### Use with GitHub Copilot

You can pipe voice commands through Copilot to Cline:
1. Use voice input in Copilot
2. Copilot runs `Send-ClineMessage.ps1` 
3. Cline receives and executes the task
4. Response is returned to Copilot

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

## Architecture

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────┐
│ GitHub Copilot  │────▶│ Send-ClineMessage│────▶│   BCline    │
│  (Voice Input)  │     │     .ps1         │     │ Extension   │
└─────────────────┘     └──────────────────┘     └─────────────┘
                                                        │
                                                        ▼
                                               ┌─────────────────┐
                                               │ MessageQueue    │
                                               │ Service.ts      │
                                               └─────────────────┘
```

## Requirements

- PowerShell 5.1+ or PowerShell Core 7+
- BCline VS Code extension v3.40.0+
- VS Code with the extension loaded
