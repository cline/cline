---
"cline/cline": patch
---

Fix Thinking blocks (Claude Sonnet 4.5) displaying as a single long line without proper word wrapping. Removed the `truncated` class that was overriding `whitespace-pre-wrap`.

Fixes #7876
