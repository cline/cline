---
"claude-dev": patch
---

fix: requests to LM Studio, Ollama, OpenAI Compatible and LiteLLM no longer die with `terminated: BodyTimeoutError (UND_ERR_BODY_TIMEOUT)` when a local model spends more than 5 minutes processing a prompt before streaming a byte
