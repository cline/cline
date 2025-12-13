---
"claude-dev": patch
---

Fix Cerebras rate limiting by using conservative max_tokens (16K) instead of model maximum.
