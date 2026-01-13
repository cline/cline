# Messaging System Setup

## Requirement

**You must have a FOLDER open in VS Code** (not just files).

```
✅ File → Open Folder → Select directory
❌ File → Open File → Select files
```

## Step 1: Open a Workspace Folder

```powershell
code C:\path\to\your\project
```

## Step 2: Verify It's Working

Check VS Code Output panel:
1. View → Output
2. Select "Cline" from dropdown
3. Look for: `Message Queue Service initialized`

## Step 3: Send a Test Message

```powershell
.\Send-ClineMessage.ps1 -Message "Hello Cline!"
```

## Directory Structure

Created automatically in your workspace:

```
your-project/
└── .message-queue/
    ├── inbox/              # Messages TO Cline
    ├── responses/          # Responses FROM Cline
    ├── copilot-to-cline.txt   # Simple text input
    └── cline-to-copilot.txt   # Simple text output
```

## Routing to Different Agents

| Prefix | Destination |
|--------|-------------|
| (none) | Cline |
| `claude:` | Claude CLI |
| `codex:` | Codex CLI |
| `gemini:` | Gemini CLI |

Example:
```powershell
.\Send-ClineMessage.ps1 -Message "claude: Explain recursion"
```

## Troubleshooting

| Issue | Fix |
|-------|-----|
| No `.message-queue` folder | Open a FOLDER, not files |
| Messages not processed | Check Output panel for errors |
| No response | Check `.message-queue/responses/` |
