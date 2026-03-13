---
"cline": minor
---

feat(sapaicore): add Claude 4.6 Opus model support

Added `anthropic--claude-4.6-opus` to the SAP AI Core provider:
- Model definition in `api.ts` (128K max tokens, 200K context, images + caching)
- Added to `anthropicModels` array in `sapaicore.ts`
- Added to converse-stream endpoint filter (uses caching-enabled API path)
- Added to stream completion handler (uses Sonnet 3.7+ streaming format)

Fixes #9644
