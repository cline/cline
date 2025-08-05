---
"@roo-code/types": patch
"roo-code": patch
---

Add support for Claude Opus 4.1 (claude-opus-4-1-20250805)

- Added claude-opus-4-1-20250805 to anthropicModels with 8192 max tokens and reasoning budget support
- Added support across all providers: Anthropic, Claude Code, Bedrock, Vertex AI, OpenRouter, and LiteLLM
- Updated anthropic.ts provider to handle prompt caching for the new model
- Pricing: $15/M input tokens, $75/M output tokens, $18.75/M cache writes, $1.5/M cache reads
