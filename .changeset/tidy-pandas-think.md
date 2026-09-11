---
"@cline/llms": patch
---

Fix Bedrock OpenAI inference profiles sending `reasoningConfig` instead of `reasoning_effort`. Preserve supported reasoning controls, normalize effort against advertised values, and suppress reasoning for Bedrock models known not to support it.
