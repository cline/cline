---
"claude-dev": patch
---

Fix Gemini Vertex models erroring when thinking parameters are not supported. Only send thinkingConfig for models that have it defined, and only send thinkingLevel for models with supportsThinkingLevel enabled.

