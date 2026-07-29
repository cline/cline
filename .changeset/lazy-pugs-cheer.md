---
"claude-dev": patch
---

fix: strip trailing slashes from the OpenAI Compatible base URL when fetching the model list, so `/models` is queried correctly and the model dropdown populates
