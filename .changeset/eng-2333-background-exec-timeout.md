---
"claude-dev": patch
---

Fix every command being killed at 30 seconds in the default Background Exec terminal mode. The extended run_commands timeout was only applied in the VS Code Terminal mode, so on a fresh install (which defaults to Background Exec) npm installs, builds, and test suites died with "Command timed out after 30000ms". The timeout override now applies to both execution modes, including the background executor's own process-kill timer.
