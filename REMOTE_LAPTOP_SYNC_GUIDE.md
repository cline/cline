# Remote Laptop Sync Guide

A complete guide to syncing Cline, voice dictation, and the CLI messaging system from this laptop to another.

## Quick Start (TL;DR)

1. **Copy Bcline folder** to USB/thumb drive
2. **On new laptop**, run PowerShell as Administrator:
```powershell
winget install Git.Git -e
winget install Microsoft.VisualStudioCode -e
winget install Gyan.FFmpeg -e
npm install -g @anthropic-ai/claude-code
npm install -g @openai/codex
npm install -g gemini-cli
```
3. **Install VSIX** extension in VS Code
4. **Configure** API keys in Cline settings
5. **Run** `auto-approve-all` command for automation

---

## Table of Contents

1. [Required Tools Installation](#required-tools-installation)
2. [VS Code Extension Installation](#vs-code-extension-installation)
3. [Voice Dictation Setup](#voice-dictation-setup)
4. [CLI Messaging System Setup](#cli-messaging-system-setup)
5. [GitHub Copilot Integration](#github-copilot-installation)
6. [Cline Configuration](#cline-configuration)
7. [Testing Your Setup](#testing-your-setup)
8. [Troubleshooting](#troubleshooting)

---

## Required Tools Installation

### Step 1: Install Git
```powershell
winget install Git.Git -e
```

### Step 2: Install VS Code
```powershell
winget install Microsoft.VisualStudioCode -e
```

### Step 3: Install Node.js (Required for CLI tools)
```powershell
winget install OpenJS.NodeJS -e
```

### Step 4: Install FFmpeg (Required for Voice Dictation)
```powershell
winget install Gyan.FFmpeg -e
```

### Step 5: Install Python (For various tools)
```powershell
winget install Python.Python.3.12 -e
```

### Step 6: Install Go (Optional - for CLI build tools)
```powershell
winget install GoLang.Go -e
```

### Step 7: Install CMake (Optional - for native modules)
```powershell
winget install Kitware.CMake -e
```

---

## VS Code Extension Installation

### Option 1: Install from VSIX (Recommended)

1. Copy the built VSIX file to the USB drive:
   - Location: `builds/claude-dev-{version}.vsix`
   - Or build it: `npm run package`

2. On the remote laptop:
   - Open VS Code
   - Press `Ctrl+Shift+P`
   - Type: `Extensions: Install from VSIX`
   - Select the VSIX file

### Option 2: Build from Source

1. Copy the entire `Bcline` folder to the remote laptop
2. Open PowerShell in the Bcline folder
3. Run:
```powershell
# Install dependencies
npm install
cd webview-ui
npm install
cd ..

# Build webview
npm run build:webview

# Package extension
npm run package
```

### Step 8: Install VSCode Extension Requirements

```powershell
# Verify installations
git --version
node --version
npm --version
ffmpeg -version
code --version
```

---

## Voice Dictation Setup

### Step 1: Sign into Cline Account

1. Open VS Code
2. Open Cline sidebar
3. Go to **Settings → Account**
4. Click "Sign in"
5. Complete authentication

> **Cost:** $0.0065 credits per minute of audio (5 min max)

### Step 2: Enable Dictation

1. Go to **Settings → Features → Dictation**
2. Toggle "Enable Dictation" ON
3. Microphone button appears in chat input

### Verify FFmpeg Installation
```powershell
where.exe ffmpeg
```

Expected output should show a path like:
```
C:\Program Files\FFmpeg\bin\ffmpeg.exe
```

---

## CLI Messaging System Setup

### Step 1: Install CLI Agents

#### Claude CLI (for `@claude` commands)
```powershell
npm install -g @anthropic-ai/claude-code
```

#### Codex CLI (for `@codex` commands - GPT-5.1)
```powershell
npm install -g @openai/codex
```

#### Gemini CLI (for `@gemini` commands)
```powershell
npm install -g gemini-cli
```

### Step 2: Verify CLI Installations
```powershell
# Check versions
claude --version
codex --version
gemini --version

# Test Claude CLI
claude -p "Say hello" --permission-mode bypassPermissions

# Test Codex CLI
codex exec -s read-only "Say hello"
```

### Step 3: Copy Messaging Scripts

Copy these files from the USB drive to your project folder:

| File | Purpose |
|------|---------|
| `Send-ClineMessage.ps1` | Send messages to Cline |
| `Set-ClineModel.ps1` | Switch OpenRouter models |
| `send-program.ps1` | Send file contents as task |

### Step 4: Understanding the Messaging System

The messaging system uses file-based communication:

```
your-project/
└── .message-queue/
    ├── inbox/              # Messages TO Cline
    ├── responses/          # Responses FROM Cline
    ├── copilot-to-cline.txt   # Simple text input
    └── cline-to-copilot.txt   # Simple text output
```

### Step 5: Enable Auto-Approval (IMPORTANT!)

Before sending tasks via messaging, enable auto-approval:
```powershell
.\Send-ClineMessage.ps1 -Message "auto-approve-all"
```

This enables:
- ✅ Read files
- ✅ Edit files
- ✅ Execute all terminal commands
- ✅ Browser access
- ✅ MCP tools

---

## GitHub Copilot Installation

### Step 1: Install GitHub Copilot Extension

1. Open VS Code
2. Press `Ctrl+Shift+X`
3. Search for "GitHub Copilot"
4. Install both:
   - **GitHub Copilot**
   - **GitHub Copilot Chat**

### Step 2: Sign into GitHub

1. Click the Copilot icon in VS Code
2. Sign in with your GitHub account
3. Ensure Copilot is enabled

### Step 3: Configure Chat Participants

Cline registers 4 persistent chat participants in Copilot Chat:

| Agent | Command | Description |
|-------|---------|-------------|
| `@claude` | `@claude <prompt>` | Routes to Claude CLI (Opus 4.5) |
| `@codex` | `@codex <prompt>` | Routes to Codex CLI (GPT-5.1) |
| `@gemini` | `@gemini <prompt>` | Routes to Gemini CLI |
| `@cline` | `@cline <task>` | Sends task to Cline agent |

### Step 4: YOLO Mode in Chat

Add `yolo:` prefix for unrestricted mode:
```
@claude yolo:delete all test files
@codex yolo:rewrite the entire API
```

---

## Cline Configuration

### Step 1: Open Cline Settings

1. Open Cline sidebar
2. Click Settings (gear icon)
3. Configure the following:

### Step 2: API Provider Setup

Choose your API provider and configure:

#### Option A: OpenRouter (Recommended)
1. Get API key from https://openrouter.ai
2. Paste key in Cline settings
3. Select model (e.g., `anthropic/claude-sonnet-4`)

#### Option B: Anthropic Direct
1. Get API key from https://anthropic.com
2. Configure in Cline settings

#### Option C: Other Providers
- OpenAI
- Google Gemini
- AWS Bedrock
- Ollama (local)
- LM Studio (local)
- VSCode LM (built-in)

### Step 3: Recommended Settings

```json
{
  "enableAutoApproval": true,
  "autoApproveModels": ["claude-sonnet-4", "gpt-5.1-codex-max"],
  "enableMcp": true,
  "enableBrowser": true,
  "enableTerminal": true
}
```

### Step 4: Switch Models via Command

```powershell
.\Send-ClineMessage.ps1 -Message "set-model:anthropic/claude-sonnet-4"
.\Send-ClineMessage.ps1 -Message "set-model:openai/gpt-5.1-codex-max"
```

---

## Testing Your Setup

### Test 1: Voice Dictation
```powershell
# Verify FFmpeg
where.exe ffmpeg
ffmpeg -version
```

1. Open VS Code
2. Open Cline sidebar
3. Look for microphone icon in chat input
4. Click and speak

### Test 2: CLI Messaging
```powershell
# Test basic message
.\Send-ClineMessage.ps1 -Message "Hello Cline!" -Wait

# Test Claude CLI routing
.\Send-ClineMessage.ps1 -Message "claude:What is 2+2?" -Wait -Timeout 30

# Test auto-approval
.\Send-ClineMessage.ps1 -Message "auto-approve-all"
```

### Test 3: Copilot Integration
1. Open Copilot Chat (`Ctrl+Alt+I`)
2. Type: `@cline Create a Python hello world script`
3. Verify it appears in Cline sidebar

### Test 4: Chat Participants
```powershell
# In Copilot Chat, try:
@claude Explain recursion
@codex Create a binary search function
@gemini What is AI?
@cline Build a todo list app
```

### Test 5: Token Usage Check
```powershell
.\Send-ClineMessage.ps1 -Message "get-usage" -Wait -Timeout 10
```

---

## Troubleshooting

### Issue: "FFmpeg required" error

**Fix:** Install FFmpeg and restart VS Code
```powershell
winget install Gyan.FFmpeg
```

### Issue: "Sign in required" for dictation

**Fix:** Cline settings → Account → Sign in

### Issue: Tasks appear stuck / no response

**Fix:** Enable auto-approval
```powershell
.\Send-ClineMessage.ps1 -Message "auto-approve-all"
```

### Issue: CLI commands fail

**Verify installations:**
```powershell
claude --version
codex --version
gemini --version
```

### Issue: No `.message-queue` folder

**Fix:** Open a FOLDER in VS Code (not just files)
```powershell
code C:\path\to\your\project
```

### Issue: Messages not processed

**Check:** Output panel → Select "Cline" from dropdown
Look for: `Message Queue Service initialized`

### Issue: Model context window errors

**Fix:** Cline auto-truncates. You can manually clear context:
```powershell
.\Send-ClineMessage.ps1 -Message "clear-context"
```

### Issue: GitHub Copilot not working

**Fix:**
1. Ensure GitHub account is linked in VS Code
2. Check Copilot subscription is active
3. Restart VS Code

---

## File Sync Checklist

Copy these from this laptop to the USB drive:

### Essential Files
- [ ] `builds/*.vsix` - Built extension
- [ ] `Send-ClineMessage.ps1` - Main messaging script
- [ ] `Set-ClineModel.ps1` - Model switcher
- [ ] `send-program.ps1` - File sender
- [ ] `CLI_MESSAGING.md` - Documentation
- [ ] `Setup-RemoteLaptop.ps1` - Remote setup script

### Optional Files
- [ ] `docs/features/SPEECH_SETUP.md` - Voice setup
- [ ] `docs/features/MESSAGING_SETUP.md` - Messaging docs
- [ ] `scripts/copilot-aliases.ps1` - Copilot shortcuts
- [ ] `scripts/copilot-task.ps1` - Copilot task runner

### Full Source (if building from source)
- [ ] Entire `Bcline/` folder (requires npm install)

---

## Recommended Startup Sequence

When starting work on the remote laptop:

```powershell
# 1. Open your project
code C:\path\to\your\project

# 2. Enable auto-approval (run FIRST)
.\Send-ClineMessage.ps1 -Message "auto-approve-all"

# 3. Set your preferred model
.\Send-ClineMessage.ps1 -Message "set-model:anthropic/claude-sonnet-4"

# 4. Now send tasks - they execute without approval waiting
.\Send-ClineMessage.ps1 -Message "Create a Python hello world script"
```

---

## Quick Reference: Agent Commands

| Command | Example |
|---------|---------|
| **Cline** | `@cline Create a todo app` |
| **Claude CLI** | `@claude Explain async/await` |
| **Claude YOLO** | `@claude yolo:Create files` |
| **Codex CLI** | `@codex Write a binary search` |
| **Codex YOLO** | `@codex yolo:Rewrite API` |
| **Gemini CLI** | `@gemini What is machine learning?` |
| **Gemini YOLO** | `@gemini yolo:Create project` |

---

## Version Information

| Component | Version | Notes |
|-----------|---------|-------|
| Cline | 3.47.0 | Current |
| Claude CLI | v2.0.60+ | For claude: commands |
| Codex CLI | v0.65.0+ | For codex: commands |
| Gemini CLI | v0.19.4+ | For gemini: commands |
| FFmpeg | Latest | For voice dictation |
| VS Code | 1.93.0+ | Required |

---

## Support

If issues persist:
1. Check VS Code Output panel → "Cline"
2. Check `.message-queue/responses/` folder
3. Review `CLI_MESSAGING.md` for detailed docs
4. Restart VS Code
5. Re-run `auto-approve-all` command

---

*Last updated: January 2025*
