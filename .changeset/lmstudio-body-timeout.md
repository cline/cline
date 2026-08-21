---
"claude-dev": patch
---

fix: LM Studio and Ollama requests no longer die with `terminated: BodyTimeoutError (UND_ERR_BODY_TIMEOUT)` when a local model spends more than 5 minutes processing a prompt without streaming a byte
