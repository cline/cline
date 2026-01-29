---
"claude-dev": patch
---

fix: use isLocatedInPath() instead of string.includes() for path containment check to prevent false positives
