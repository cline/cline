---
"claude-dev": patch
---

feat(terminal): add background command tracking and summary

- Add background command tracking for "Proceed While Running" functionality
- Track commands in StandaloneTerminalManager with log file output
- Add 10-minute hard timeout to prevent zombie processes
- Centralize terminal constants in constants.ts
- Fix process group termination to kill entire process tree (npm run dev, etc.)
- Add large output protection with file-based logging
- Add clickable log file paths in terminal output UI
- Fix "Not Executed" → "Skipped" label for commands
