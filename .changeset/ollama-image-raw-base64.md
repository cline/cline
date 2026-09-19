---
"claude-dev": patch
---

Fix Ollama vision models ignoring attached images: images are now sent to Ollama as raw base64 instead of data URIs, which Ollama rejected with a 400
