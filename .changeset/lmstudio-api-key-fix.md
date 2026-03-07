---
"cline": patch
---

feat(lmstudio): add API key field for authenticated servers

- Add lmStudioApiKey to secrets storage (VSCode encrypted storage)
- Wire API key through handler factory to LM Studio provider
- Add password-masked UI field in provider settings
- Add proto-conversion for gRPC serialization
- Key sent as Authorization: Bearer header via OpenAI SDK
- Backward compatible: field optional, falls back to 'noop' if not provided
