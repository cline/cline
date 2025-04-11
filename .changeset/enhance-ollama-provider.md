---
"claude-dev": minor
---

Enhance Ollama provider with retry mechanism, timeout handling, and improved error handling. This change adds robust error handling, automatic retries, timeout handling, and improved stream processing to the Ollama provider, making it more reliable and preventing the infinite "thinking" problem. Tests are now skipped if Ollama is not running locally.
