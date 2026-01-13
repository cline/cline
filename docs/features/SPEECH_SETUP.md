# Speech/Dictation Setup

## Requirements

1. **Cline Account** - Sign in required (Settings → Account)
2. **FFmpeg** - Audio capture tool

## Step 1: Sign into Cline

1. Open Cline sidebar
2. Go to Settings → Account
3. Click "Sign in"
4. Complete authentication

> Cost: $0.0065 credits per minute of audio (5 min max)

## Step 2: Install FFmpeg

### Windows
```powershell
winget install Gyan.FFmpeg
```

### macOS
```bash
brew install ffmpeg
```

### Linux
```bash
sudo apt-get install ffmpeg
```

## Step 3: Enable Dictation

1. Settings → Features → Dictation
2. Toggle "Enable Dictation" ON
3. Microphone button appears in chat input

## Verify Setup

```powershell
# Windows
where.exe ffmpeg

# macOS/Linux
which ffmpeg
```

## Troubleshooting

| Issue | Fix |
|-------|-----|
| "FFmpeg required" | Install FFmpeg, restart VS Code |
| "Sign in required" | Settings → Account → Sign in |
| No audio | Check Windows Sound → Input devices |
