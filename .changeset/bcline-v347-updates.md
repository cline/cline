---
"cline": minor
---

Add voice input improvements, messaging system tests, and Claude CLI integration with v3.47 merge

### Voice Input Improvements
- Added Web Speech API real-time voice input with streaming transcription
- Fixed Windows voice dictation with dynamic FFmpeg device detection
- Fixed FFmpeg process termination on Windows
- Added real-time interim text display while speaking
- Green pulsing indicator when actively listening

### Messaging & CLI
- Added comprehensive messaging system tests (Test-ClineMessaging.ps1)
- Enhanced Claude CLI integration with Send-ClineMessage.ps1
- Improved messaging reliability and error handling

### Merged v3.47.0
- Background edit feature support
- Updated free models list
- All upstream fixes and improvements
