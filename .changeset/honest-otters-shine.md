---
"claude-dev": patch
---

fix: honor the configured terminal profile in background execution mode

When using the "Background Exec" terminal execution mode, Cline ignored the
"Default Terminal Profile" setting and always spawned the system default shell.
The standalone terminal manager now resolves the selected profile to its shell
path when creating (and reusing) terminals, matching the behavior of the VSCode
terminal manager.
