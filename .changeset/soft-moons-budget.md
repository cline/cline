---
"claude-dev": patch
---

Keep the `context_length` / `max_completion_tokens` reported by models-source payloads on the resulting model entries, so auto-compaction and output budgets follow the source limits instead of falling back to the 128K default
