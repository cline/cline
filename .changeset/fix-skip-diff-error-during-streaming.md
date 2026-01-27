---
"claude-dev": patch
---

fix: skip diff error UI handling during streaming to prevent flickering

Suppress diff view error notifications while content is actively streaming to prevent visual flickering and improve user experience. Error handling is deferred until streaming completes.
