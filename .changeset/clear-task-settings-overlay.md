---
"claude-dev": patch
---

Fix auto-approve checkboxes freezing after "New Task": clear the task-scoped settings overlay when the task view is cleared or switched, so stale task settings no longer shadow global settings
