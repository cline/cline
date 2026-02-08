---
"claude-dev": patch
---

fix: use max_completion_tokens for GPT-5 models in OpenAI compatible provider

GPT-5 and other reasoning models (o1, o3, o4) require the `max_completion_tokens` parameter instead of `max_tokens`. This fix conditionally uses the correct parameter based on whether the model is in the reasoning model family.

Fixes #8912
