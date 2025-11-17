# SAP AI Core Implementation - Summary

## Quick Reference

This document provides a quick overview of the SAP AI Core implementation extracted from the Cline codebase for integration with LiteLLM.

---

## Files Generated

### 1. `SAP_AI_CORE_LITELLM_IMPLEMENTATION.md`
Comprehensive implementation guide with:
- Complete architecture overview
- Authentication flow (OAuth 2.0)
- Deployment management
- Anthropic converse-stream implementation
- Prompt caching with AWS Bedrock cachePoint format
- Stream parsing
- Complete TypeScript examples
- Error handling
- Testing strategies
- LiteLLM integration suggestions

### 2. `sapaicore_provider.py`
Ready-to-use Python implementation featuring:
- `SapAiCoreProvider` class for LiteLLM integration
- `TokenManager` for OAuth 2.0 authentication
- `DeploymentManager` for deployment discovery
- `MessageFormatter` for Bedrock Converse API formatting
- Complete streaming support
- Caching support
- Error handling
- Example usage

---

## Key Cline Source Files

### Core Implementation
- **`src/core/api/providers/sapaicore.ts`** (1051 lines)
  - Main SAP AI Core handler implementation
  - Authentication and token management
  - Deployment fetching and management
  - Message formatting for Bedrock Converse API
  - Streaming parsers for multiple model types
  - Caching implementation

### Supporting Files
- **`src/core/controller/models/getSapAiCoreModels.ts`** (151 lines)
  - Fetches available deployments from SAP AI Core
  - Checks for orchestration availability
  - Maps models to deployment IDs

- **`src/shared/api.ts`** (lines 3251-3417)
  - Model definitions for all supported SAP AI Core models
  - Context windows and token limits
  - Pricing information (Capacity Units)

### Tests
- **`src/core/api/providers/__tests__/sapaicore.test.ts`** (132 lines)
  - Unit tests for SAP AI Core handler
  - Image processing tests
  - Model variant tests

### UI Components
- **`webview-ui/src/components/settings/providers/SapAiCoreProvider.tsx`**
  - UI for SAP AI Core configuration

- **`webview-ui/src/components/settings/SapAiCoreModelPicker.tsx`**
  - Model selection UI with deployment management

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                      LiteLLM Client                         │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│              SAP AI Core Provider Layer                     │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  TokenManager (OAuth 2.0 Client Credentials)         │   │
│  └──────────────────────────────────────────────────────┘   │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  DeploymentManager (Fetch & Map Deployments)         │   │
│  └──────────────────────────────────────────────────────┘   │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  MessageFormatter (Bedrock Converse API Format)      │   │
│  └──────────────────────────────────────────────────────┘   │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│                  SAP AI Core API Endpoints                  │
│                                                             │
│  • /oauth/token (Authentication)                            │
│  • /v2/lm/deployments (Deployment Management)               │
│  • /v2/inference/deployments/{id}/converse-stream           │
│    ├─ Claude 4.5, 4, 4 Opus, 3.7 (with caching)            │
│  • /v2/inference/deployments/{id}/invoke-with-response-stream│
│    ├─ Claude 3.5, 3, 3 Haiku, 3 Opus (without caching)     │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│            Underlying Model Providers                       │
│  • Anthropic (Claude models)                                │
│  • OpenAI (GPT models)                                      │
│  • Google (Gemini models)                                   │
└─────────────────────────────────────────────────────────────┘
```

---

## Key Implementation Details

### 1. Authentication Flow

```typescript
1. Client provides credentials:
   - clientId
   - clientSecret
   - tokenUrl (e.g., https://tenant.authentication.sap.hana.ondemand.com)

2. Request access token:
   POST {tokenUrl}/oauth/token
   Body: grant_type=client_credentials&client_id=...&client_secret=...

3. Receive token:
   {
     "access_token": "...",
     "expires_in": 3600,
     "token_type": "Bearer"
   }

4. Use token for API requests:
   Authorization: Bearer {access_token}
```

### 2. Message Format (Converse API)

**Input (Anthropic format):**
```json
{
  "role": "user",
  "content": [
    {"type": "text", "text": "Hello"},
    {
      "type": "image",
      "source": {
        "type": "base64",
        "media_type": "image/png",
        "data": "iVBORw0KG..."
      }
    }
  ]
}
```

**Output (Bedrock Converse format):**
```json
{
  "role": "user",
  "content": [
    {"text": "Hello"},
    {
      "image": {
        "format": "png",
        "source": {"bytes": "iVBORw0KG..."}
      }
    }
  ]
}
```

### 3. Caching (AWS Bedrock cachePoint)

**System Message with Cache:**
```json
{
  "system": [
    {"text": "You are a helpful assistant."},
    {"cachePoint": {"type": "default"}}
  ]
}
```

**User Message with Cache:**
```json
{
  "role": "user",
  "content": [
    {"text": "What is the capital of France?"},
    {"cachePoint": {"type": "default"}}
  ]
}
```

### 4. Streaming Response Format

**Converse-Stream Events:**
```
data: {"contentBlockDelta":{"delta":{"text":"Hello"}}}
data: {"contentBlockDelta":{"delta":{"text":" world"}}}
data: {"metadata":{"usage":{"inputTokens":100,"outputTokens":20}}}
```

**Parsed Output:**
```json
{"type": "text", "text": "Hello"}
{"type": "text", "text": " world"}
{
  "type": "usage",
  "prompt_tokens": 100,
  "completion_tokens": 20,
  "cache_read_input_tokens": 50,
  "cache_creation_input_tokens": 50
}
```

---

## Supported Models

### Anthropic Models (Converse-Stream with Caching)

| Model ID | Max Tokens | Context Window | Caching |
|----------|-----------|----------------|---------|
| `anthropic--claude-4.5-sonnet` | 8,192 | 200,000 | ✓ |
| `anthropic--claude-4-sonnet` | 8,192 | 200,000 | ✓ |
| `anthropic--claude-4-opus` | 8,192 | 200,000 | ✓ |
| `anthropic--claude-3.7-sonnet` | 64,000 | 200,000 | ✓ |

### Anthropic Models (Invoke-Stream without Caching)

| Model ID | Max Tokens | Context Window | Caching |
|----------|-----------|----------------|---------|
| `anthropic--claude-3.5-sonnet` | 8,192 | 200,000 | ✗ |
| `anthropic--claude-3-sonnet` | 4,096 | 200,000 | ✗ |
| `anthropic--claude-3-haiku` | 4,096 | 200,000 | ✗ |
| `anthropic--claude-3-opus` | 4,096 | 200,000 | ✗ |

### Other Models

SAP AI Core also supports:
- **OpenAI**: gpt-4, gpt-4o, gpt-4o-mini, o1, o3, o3-mini, gpt-5, etc.
- **Google Gemini**: gemini-2.5-pro, gemini-2.5-flash (with thinking support)

---

## Code Locations (Line References)

### Authentication
- Token management: `sapaicore.ts:377-400`
- OAuth flow: `sapaicore.ts:377-394`

### Deployment Management
- Fetch deployments: `sapaicore.ts:404-436`
- Find deployment by model: `sapaicore.ts:438-455`

### Message Formatting
- Bedrock namespace: `sapaicore.ts:45-222`
- Format messages: `sapaicore.ts:119-159`
- Process images: `sapaicore.ts:164-221`

### Caching
- Prepare system messages: `sapaicore.ts:69-79`
- Apply cache control: `sapaicore.ts:85-113`

### Streaming
- Main create message: `sapaicore.ts:462-467`
- Converse-stream setup: `sapaicore.ts:608-633`
- Stream parser (Sonnet 3.7+): `sapaicore.ts:810-886`
- Stream parser (older models): `sapaicore.ts:758-808`

### Model Definitions
- Model list and configs: `api.ts:3256-3417`

---

## Integration Checklist for LiteLLM

- [ ] Add SAP AI Core to provider list
- [ ] Implement OAuth 2.0 authentication
- [ ] Add deployment management
- [ ] Implement Bedrock Converse API message formatting
- [ ] Add cachePoint support for prompt caching
- [ ] Implement converse-stream parser
- [ ] Implement invoke-with-response-stream parser (legacy)
- [ ] Add model definitions to model registry
- [ ] Add error handling for SAP-specific errors
- [ ] Add tests for authentication, deployment, and streaming
- [ ] Document configuration in LiteLLM docs

---

## Quick Start Example

```python
from sapaicore_provider import SapAiCoreProvider
import asyncio

async def main():
    provider = SapAiCoreProvider(
        client_id="your-client-id",
        client_secret="your-client-secret",
        token_url="https://tenant.authentication.sap.hana.ondemand.com",
        base_url="https://api.ai.ml.hana.ondemand.com",
        resource_group="default",
    )

    messages = [{"role": "user", "content": "Hello!"}]

    async for chunk in await provider.completion(
        model="anthropic--claude-4-sonnet",
        messages=messages,
        stream=True,
        max_tokens=8192,
    ):
        if chunk["type"] == "text":
            print(chunk["text"], end="", flush=True)

asyncio.run(main())
```

---

## Key Differences from Native Anthropic API

| Feature | Anthropic Native | SAP AI Core |
|---------|-----------------|-------------|
| **Endpoint** | `api.anthropic.com` | `api.ai.ml.hana.ondemand.com` |
| **Auth** | API Key | OAuth 2.0 Client Credentials |
| **Model Selection** | Model name | Deployment ID |
| **Caching** | `cache_control` blocks | `cachePoint` objects |
| **Message Format** | Anthropic format | AWS Bedrock Converse format |
| **Response Format** | Anthropic SSE | Bedrock SSE with different structure |

---

## Testing

### Unit Tests (from Cline)
- Authentication flow
- Deployment fetching
- Message formatting
- Image processing
- Model selection
- Caching application

### Integration Tests Needed
- End-to-end streaming with real SAP AI Core instance
- Token refresh on expiration
- Deployment ID caching
- Error handling for various failure scenarios
- Prompt caching validation

---

## Additional Resources

- **SAP AI Core Docs**: https://help.sap.com/docs/sap-ai-core
- **AWS Bedrock Converse API**: https://docs.aws.amazon.com/bedrock/latest/userguide/conversation-inference.html
- **Anthropic API**: https://docs.anthropic.com/
- **LiteLLM**: https://docs.litellm.ai/

---

## Contact & Support

For questions about this implementation:
1. Review the comprehensive guide: `SAP_AI_CORE_LITELLM_IMPLEMENTATION.md`
2. Check the Python implementation: `sapaicore_provider.py`
3. Review Cline source: `src/core/api/providers/sapaicore.ts`

---

## License

Based on the Cline implementation. Please check Cline's license for usage terms.
