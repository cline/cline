# Remote Laptop - Quick Reference Card

## One-Line Install Command

Run as Administrator in PowerShell:
```powershell
winget install Git.Git Microsoft.VisualStudioCode OpenJS.NodeJS Gyan.FFmpeg Python.Python.3.12 -e; npm install -g @anthropic-ai/claude-code @openai/codex gemini-cli
```

## Install VSIX Extension

1. `Ctrl+Shift+P` → "Extensions: Install from VSIX" → Select `.vsix` file

## Daily Startup Commands

```powershell
# Enable auto-approval (run FIRST!)
.\Send-ClineMessage.ps1 -Message "auto-approve-all"

# Set model
.\Send-ClineMessage.ps1 -Message "set-model:anthropic/claude-sonnet-4"
```

## Send Tasks to Cline

```powershell
# Basic task
.\Send-ClineMessage.ps1 -Message "Create a hello world script"

# Wait for response
.\Send-ClineMessage.ps1 -Message "What is 2+2?" -Wait -Timeout 30

# Route to Claude CLI
.\Send-ClineMessage.ps1 -Message "claude:Explain recursion"

# Route to Codex CLI
.\Send-ClineMessage.ps1 -Message "codex:Create binary search"
```

## Copilot Chat Commands

```
@cline Create a todo app
@claude Explain async/await
@codex Write binary search
@gemini What is AI?
@claude yolo:Create files (auto-approve)
@codex yolo:Rewrite API (bypass sandbox)
```

## Check Status

```powershell
# Token usage
.\Send-ClineMessage.ps1 -Message "get-usage" -Wait -Timeout 10

# Verify CLI tools
claude --version
codex --version
gemini --version

# Verify FFmpeg
where.exe ffmpeg
```

## Troubleshooting Quick Fixes

| Problem | Fix |
|---------|-----|
| Tasks stuck | Run `auto-approve-all` |
| No voice | Install FFmpeg, sign into Cline |
| No `.message-queue` | Open a FOLDER, not files |
| CLI fails | Check `claude --version` |
| No response | Check Output panel → "Cline" |

## File Locations to Copy

```
USB Drive:
├── builds/*.vsix                    # Extension
├── Send-ClineMessage.ps1            # Main script
├── Set-ClineModel.ps1               # Model switcher
├── CLI_MESSAGING.md                 # Full docs
└── REMOTE_LAPTOP_SYNC_GUIDE.md      # Complete guide
```

## API Keys Needed

| Service | URL |
|---------|-----|
| OpenRouter | https://openrouter.ai/keys |
| Anthropic | https://console.anthropic.com/ |
| GitHub Copilot | https://github.com/settings/copilot |

---

*Keep this file handy on the USB drive!*
