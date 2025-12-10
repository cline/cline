---
"claude-dev": patch
---

Make initial checkpoint commit non-blocking while ensuring safe execution of tools. This improves responsiveness when starting tasks in large repositories by allowing read-only tools to run in parallel with the initial git commit.

