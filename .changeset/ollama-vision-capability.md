---
"claude-dev": patch
---

Fix Ollama vision models being treated as text-only: the chat now reads each model's capabilities from Ollama, so image attachments are accepted and the "doesn't support images" warning no longer appears for vision models
