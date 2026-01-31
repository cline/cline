---
"claude-dev": patch
---

fix: use isLocatedInPath for proper path containment check

Fixes #8761 - Path containment check uses string.includes() causing false positives

The previous implementation used `absolutePath.includes(cwd)` which could incorrectly match
paths like `/home/user/project-backup` when working in `/home/user/project`.

Changed to use the existing `isLocatedInPath()` function which properly handles path boundaries
using `path.relative()` to determine if a path is actually contained within another.
