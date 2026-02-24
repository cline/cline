---
"claude-dev": patch
---

Add configurable context compaction threshold: users can now set a custom token limit per plan/act mode (via the API configuration settings) at which auto-compaction triggers. This is useful for large-context models where the default threshold is expensive.
