---
"@roo-cline/core": patch
---

feat(lmstudio): fix API key field - add proto-conversion and remove from plain-text settings

- Add lmStudioApiKey to proto-conversion (serialization/deserialization)
- Remove lmStudioApiKey from API_HANDLER_SETTINGS_FIELDS (keep only in SECRETS_KEYS)
- Follows same pattern as ollamaApiKey for proper security and gRPC handling
