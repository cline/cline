---
"roo-cline": patch
---

Changes maxTokens to 8192 for anthropic models that supports it
anthropic/claude-3-sonnet, claude-3-opus, claude-3-haiku supports maxTokens of 4096.
This change keeps the max tokens the same for those models
