---
"claude-dev": patch
---

Set pager environment variables (PAGER, GIT_PAGER, MANPAGER) to "cat" when creating VSCode terminals to prevent commands like `git diff` and `git log` from hanging in interactive pagers.

Fixes #8582
