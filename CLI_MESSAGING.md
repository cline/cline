# BCline CLI Messaging System

A bidirectional file-based messaging system that enables external processes (like GitHub Copilot) to communicate with BCline, Claude CLI, and Codex CLI.

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
        │                                               ├───────────────────┐
        │                                               ▼                   ▼
        │                                      ┌─────────────────┐ ┌─────────────────┐
        └─────────────────────────────────────▶│   Codex CLI     │ │   Gemini CLI    │
                                               │  (GPT-5.1 Max)  │ │   (Google)      │
                                               └─────────────────┘ └─────────────────┘
```

**Five AI Channels:**
1. **Copilot** - Voice/chat in VS Code (Claude Opus 4.5 Preview)
2. **Cline** - Via `Send-ClineMessage.ps1` (OpenRouter models)
3. **Claude CLI** - Via `claude:` prefix (Claude Opus 4.5)
4. **Codex CLI** - Via `codex:` prefix (GPT-5.1-codex-max)
5. **Gemini CLI** - Via `gemini:` prefix (Google Gemini)

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

### Send to Codex CLI (via Cline):
```powershell
.\Send-ClineMessage.ps1 -Message "codex:Create a binary search function in Python"
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

### Codex CLI Commands
| Command | Description |
|---------|-------------|
| `codex:<prompt>` | Send prompt to Codex CLI (GPT-5.1) in read-only mode |
| `codex-yolo:<prompt>` | Send prompt to Codex CLI with FULL agent mode (bypasses all approvals and sandbox) |

### Gemini CLI Commands
| Command | Description |
|---------|-------------|
| `gemini:<prompt>` | Send prompt to Gemini CLI (Google) |
| `gemini-yolo:<prompt>` | Send prompt to Gemini CLI with YOLO mode (auto-approve all) |

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

### Send to Codex CLI (GPT-5.1):
```powershell
.\Send-ClineMessage.ps1 -Message "codex:Explain how async/await works in JavaScript" -Wait -Timeout 60
```

### Send to Codex CLI with full-auto:
```powershell
.\Send-ClineMessage.ps1 -Message "codex-yolo:Create a REST API server in Node.js"
```

## Voice Workflow (Copilot → Cline → Claude CLI / Codex CLI)

With this system, you can use voice input through GitHub Copilot to orchestrate multiple AI agents:

1. **Speak to Copilot** (using voice input)
2. **Copilot runs commands** via `Send-ClineMessage.ps1`
3. **Cline receives and processes** the message
4. **Claude CLI executes** if using `claude:` prefix
5. **Response flows back** through the chain

## ⚠️ Auto-Approval Setup (IMPORTANT)

Before sending tasks to Cline via the messaging system, **enable auto-approval** to prevent tasks from getting stuck waiting for manual approval:

### Enable Auto-Approval (Required for Automation)
```powershell
# Run this FIRST before sending any automated tasks
.\Send-ClineMessage.ps1 -Message "auto-approve-all"
```

This enables:
- ✅ Read files
- ✅ Edit files  
- ✅ Execute all terminal commands
- ✅ Browser access
- ✅ MCP tools

### Why This Matters
- Without auto-approval, Cline will wait for manual "Approve" clicks in the UI
- Tasks sent via messaging will appear stuck/unresponsive
- The `auto-approve-all` command must be sent after each VS Code restart

### Recommended Startup Sequence
```powershell
# 1. Enable auto-approval first
.\Send-ClineMessage.ps1 -Message "auto-approve-all"

# 2. Set your preferred model
.\Send-ClineMessage.ps1 -Message "set-model:openai/gpt-5.1-codex-max"

# 3. Now send tasks - they will execute without waiting for approval
.\Send-ClineMessage.ps1 -Message "Create a Python hello world script"
```

### CLI Auto-Approval
All CLI agents run in auto-approve mode by default:
- `claude:` - Uses `--permission-mode bypassPermissions`
- `codex:` - Uses `--dangerously-bypass-approvals-and-sandbox`
- `gemini:` - Uses `--yolo` flag

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
- BCline VS Code extension v3.40.1+
- VS Code with the extension loaded
- Claude CLI v2.0.60+ (`npm install -g @anthropic-ai/claude-code`) for claude: commands
- Codex CLI v0.65.0+ (`npm install -g @openai/codex`) for codex: commands
- Gemini CLI v0.19.4+ (`npm install -g gemini-cli`) for gemini: commands

### Update CLI Agents
```powershell
npm update -g @anthropic-ai/claude-code @openai/codex
```

## Chat Participants (@agents)

BCline registers persistent chat participants in GitHub Copilot Chat:

| Agent | Usage | Description |
|-------|-------|-------------|
| `@claude` | `@claude <prompt>` | Routes to Claude CLI (Opus 4.5) |
| `@codex` | `@codex <prompt>` | Routes to Codex CLI (GPT-5.1) |
| `@gemini` | `@gemini <prompt>` | Routes to Gemini CLI (Google) |
| `@cline` | `@cline <task>` | Sends task to Cline agent |

### YOLO Mode in Chat Participants
Add `yolo:` prefix to your prompt for unrestricted mode:
- `@claude yolo:delete all test files` - skips permission checks
- `@codex yolo:rewrite the entire API` - bypasses sandbox
- `@gemini yolo:create files` - auto-approves all actions

These agents persist across VS Code restarts and appear in the Copilot Chat autocomplete.

## Communication Paths

### Path 1: Direct (2-way)
```
You → Copilot → Claude/Codex/Gemini CLI
```
Copilot runs CLI commands directly.

### Path 2: Via Cline Router (3-way)
```
You → Copilot → Cline (router) → Claude/Codex/Gemini CLI
```
Messages tracked in `.message-queue/` with full logging.
**Note:** Cline acts as a router only - does NOT use OpenRouter API.

### Path 3: Via Cline AI (uses OpenRouter)
```
You → Copilot → Cline (AI) → OpenRouter API
```
Send a regular message without prefix - Cline processes with its AI model.

### Path 4: Chat Participants
```
You → @claude/@codex/@gemini/@cline → Target Agent
```
Persistent agents in Copilot Chat UI.

## Troubleshooting

### Task Appears Stuck / No Response

**Symptoms:**
- "Task started" response but no completion
- Cline panel shows pending approval
- No file created after task

**Solution:**
```powershell
# Enable auto-approval
.\Send-ClineMessage.ps1 -Message "auto-approve-all"
# Then retry your task
```

### API Sluggish / Slow Response

**Possible Causes:**
1. **OpenRouter API latency** - External provider issue, nothing to fix
2. **Model overloaded** - Try switching models:
   ```powershell
   .\Send-ClineMessage.ps1 -Message "set-model:anthropic/claude-sonnet-4"
   ```
3. **Complex task** - Break into smaller steps

### Python Command Not Found (Windows)

**Symptoms:** Cline runs `python` but it fails

**Solution:** Windows uses `py` launcher, not `python`. The AI should detect this automatically. If not, the task still succeeds - only the execution test fails.

### CLI Commands Fail

**Claude CLI:**
```powershell
# Verify installation
claude --version
# Test directly
claude -p "Say hello"
```

**Codex CLI:**
```powershell
# Verify installation
codex --version
# Test directly
codex exec -s read-only "Say hello"
```

**Gemini CLI:**
```powershell
# Verify installation
gemini --version
# Test directly  
gemini "Say hello"
```

### Files Created in Wrong Directory (Gemini 3-way)

**Fixed in v3.40.1:** Gemini CLI now uses workspace directory for file operations.

If still occurring, update to latest BCline version.

## Bug Fixes (v3.40.1)

| Issue | Description | Status |
|-------|-------------|--------|
| #7590 | execute_command now validates exit codes and reports failures | ✅ Fixed |
| #7902 | LiteLLM Provider Context Window Bar now displays correctly | ✅ Fixed |
| #7876 | Thinking blocks now have proper newline display (whiteSpace pre-wrap) | ✅ Fixed |

## Version History

| Version | Date | Changes |
|---------|------|---------|
| 3.40.1 | 2025-12-06 | Merged upstream v3.40.1, bug fixes #7590/#7902/#7876, updated CLI agents |
| 3.40.0 | 2025-12-05 | Agent orchestration, Gemini CLI, 4 chat participants, voice input |
| 3.39.2 | 2025-12-04 | MessageQueueService, Claude/Codex CLI integration |
