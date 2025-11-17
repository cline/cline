# SAP AI Core Implementation for LiteLLM

## Overview

This document provides a comprehensive guide for implementing SAP AI Core Anthropic converse-stream support in LiteLLM. The implementation is based on the Cline codebase which successfully integrates SAP AI Core with multiple model providers including Anthropic Claude, OpenAI GPT, and Google Gemini.

## Architecture

SAP AI Core acts as a managed AI service that provides access to various LLM providers through a unified API. The key components are:

1. **Authentication**: OAuth 2.0 client credentials flow
2. **Deployment Management**: Models are deployed on SAP AI Core and accessed via deployment IDs
3. **Streaming Support**: Uses AWS Bedrock-style converse-stream API for Anthropic models
4. **Prompt Caching**: Supports AWS Bedrock-style cachePoint objects for caching

## Key Files from Cline Implementation

- **Main Handler**: `src/core/api/providers/sapaicore.ts` (1051 lines)
- **Model Fetching**: `src/core/controller/models/getSapAiCoreModels.ts`
- **Model Definitions**: `src/shared/api.ts` (lines 3251-3417)
- **Tests**: `src/core/api/providers/__tests__/sapaicore.test.ts`

---

## 1. Authentication

### OAuth 2.0 Client Credentials Flow

```typescript
interface Token {
  access_token: string
  expires_in: number
  scope: string
  jti: string
  token_type: string
  expires_at: number
}

interface SapAiCoreCredentials {
  clientId: string
  clientSecret: string
  tokenUrl: string // e.g., "https://<tenant>.authentication.sap.hana.ondemand.com"
  baseUrl: string  // e.g., "https://api.ai.ml.hana.ondemand.com"
  resourceGroup?: string // defaults to "default"
}

async function authenticate(credentials: SapAiCoreCredentials): Promise<Token> {
  const payload = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: credentials.clientId,
    client_secret: credentials.clientSecret,
  })

  const tokenUrl = credentials.tokenUrl.replace(/\/+$/, "") + "/oauth/token"

  const response = await fetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: payload,
  })

  const token = await response.json() as Token
  token.expires_at = Date.now() + token.expires_in * 1000
  return token
}
```

### Token Management

```typescript
class TokenManager {
  private token?: Token

  async getToken(credentials: SapAiCoreCredentials): Promise<string> {
    if (!this.token || this.token.expires_at < Date.now()) {
      this.token = await authenticate(credentials)
    }
    return this.token.access_token
  }
}
```

---

## 2. Deployment Management

### Fetching Deployments

```typescript
interface Deployment {
  id: string
  name: string // format: "model-name:version"
  scenarioId?: string
  targetStatus: string
}

async function fetchDeployments(
  accessToken: string,
  baseUrl: string,
  resourceGroup: string = "default"
): Promise<Deployment[]> {
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    "AI-Resource-Group": resourceGroup,
    "Content-Type": "application/json",
    "AI-Client-Type": "LiteLLM", // Identify your client
  }

  const url = `${baseUrl}/v2/lm/deployments?$top=10000&$skip=0`

  const response = await fetch(url, { headers })
  const data = await response.json()

  return data.resources
    .filter((deployment: any) => deployment.targetStatus === "RUNNING")
    .map((deployment: any) => {
      const model = deployment.details?.resources?.backend_details?.model
      if (!model?.name || !model?.version) {
        return null
      }
      return {
        id: deployment.id,
        name: `${model.name}:${model.version}`,
        scenarioId: deployment.scenarioId,
        targetStatus: deployment.targetStatus,
      }
    })
    .filter((deployment: any) => deployment !== null)
}

function findDeploymentForModel(deployments: Deployment[], modelId: string): string | null {
  const deployment = deployments.find((d) => {
    const deploymentBaseName = d.name.split(":")[0].toLowerCase()
    const modelBaseName = modelId.split(":")[0].toLowerCase()
    return deploymentBaseName === modelBaseName
  })

  return deployment?.id || null
}
```

---

## 3. Anthropic Converse-Stream Implementation

This is the **core implementation** for streaming Anthropic models on SAP AI Core.

### 3.1 Message Formatting

SAP AI Core uses AWS Bedrock's Converse API format for Anthropic models (Claude 4.5, 4, 4 Opus, 3.7).

```typescript
// AWS Bedrock Converse API types
enum BedrockConversationRole {
  USER = "user",
  ASSISTANT = "assistant",
}

interface BedrockContentBlock {
  text?: string
  image?: {
    format: "png" | "jpeg" | "gif" | "webp"
    source: {
      bytes: string // base64 encoded
    }
  }
  cachePoint?: {
    type: "default"
  }
}

interface BedrockMessage {
  role: BedrockConversationRole
  content: BedrockContentBlock[]
}

/**
 * Convert messages to AWS Bedrock Converse API format
 */
function formatMessagesForConverseAPI(messages: Array<{
  role: "user" | "assistant"
  content: string | Array<{ type: string; text?: string; source?: any }>
}>): BedrockMessage[] {
  return messages.map((message) => {
    const role = message.role === "user"
      ? BedrockConversationRole.USER
      : BedrockConversationRole.ASSISTANT

    let content: BedrockContentBlock[] = []

    if (typeof message.content === "string") {
      content = [{ text: message.content }]
    } else if (Array.isArray(message.content)) {
      content = message.content
        .map((item) => {
          if (item.type === "text") {
            return { text: item.text }
          }

          if (item.type === "image") {
            return processImageContent(item)
          }

          return null
        })
        .filter((item): item is BedrockContentBlock => item !== null)
    }

    return { role, content }
  })
}

function processImageContent(item: any): BedrockContentBlock | null {
  let format: "png" | "jpeg" | "gif" | "webp" = "jpeg"

  if (item.source.media_type) {
    const formatMatch = item.source.media_type.match(/image\/(\w+)/)
    if (formatMatch && formatMatch[1]) {
      const extractedFormat = formatMatch[1]
      if (["png", "jpeg", "gif", "webp"].includes(extractedFormat)) {
        format = extractedFormat as "png" | "jpeg" | "gif" | "webp"
      }
    }
  }

  try {
    let imageData: string

    if (typeof item.source.data === "string") {
      // Remove data URI prefix if present
      imageData = item.source.data.replace(/^data:image\/\w+;base64,/, "")
    } else {
      // Handle Buffer/Uint8Array
      const buffer = Buffer.from(item.source.data as Uint8Array)
      imageData = buffer.toString("base64")
    }

    return {
      image: {
        format,
        source: {
          bytes: imageData,
        },
      },
    }
  } catch (error) {
    console.error("Failed to process image content:", error)
    return {
      text: `[ERROR: Failed to process image - ${error instanceof Error ? error.message : "Unknown error"}]`,
    }
  }
}
```

### 3.2 Prompt Caching

SAP AI Core supports AWS Bedrock-style prompt caching using `cachePoint` objects.

```typescript
/**
 * Prepare system messages with caching support
 */
function prepareSystemMessages(systemPrompt: string, enableCaching: boolean = true): any[] {
  if (!systemPrompt) {
    return []
  }

  if (enableCaching) {
    return [
      { text: systemPrompt },
      { cachePoint: { type: "default" } } // Mark cache point
    ]
  }

  return [{ text: systemPrompt }]
}

/**
 * Apply cache control to messages
 * Caches the last two user messages for optimal performance
 */
function applyCacheControlToMessages(
  messages: BedrockMessage[],
  lastUserMsgIndex: number,
  secondLastMsgUserIndex: number
): BedrockMessage[] {
  return messages.map((message, index) => {
    // Add cachePoint to the last user message and second-to-last user message
    if (index === lastUserMsgIndex || index === secondLastMsgUserIndex) {
      const messageWithCache = { ...message }

      if (messageWithCache.content && Array.isArray(messageWithCache.content)) {
        messageWithCache.content = [
          ...messageWithCache.content,
          { cachePoint: { type: "default" } }
        ]
      }

      return messageWithCache
    }

    return message
  })
}
```

### 3.3 API Request

```typescript
interface ConverseStreamRequest {
  inferenceConfig: {
    maxTokens: number
    temperature: number
  }
  system: Array<{ text: string } | { cachePoint: { type: "default" } }>
  messages: BedrockMessage[]
}

async function createConverseStreamRequest(
  accessToken: string,
  baseUrl: string,
  resourceGroup: string,
  deploymentId: string,
  systemPrompt: string,
  messages: any[],
  options: {
    maxTokens?: number
    temperature?: number
    enableCaching?: boolean
  } = {}
): Promise<Response> {
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    "AI-Resource-Group": resourceGroup,
    "Content-Type": "application/json",
    "AI-Client-Type": "LiteLLM",
  }

  const url = `${baseUrl}/v2/inference/deployments/${deploymentId}/converse-stream`

  // Format messages
  const formattedMessages = formatMessagesForConverseAPI(messages)

  // Get user message indices for caching
  const userMsgIndices = messages.reduce(
    (acc, msg, index) => (msg.role === "user" ? [...acc, index] : acc),
    [] as number[]
  )
  const lastUserMsgIndex = userMsgIndices[userMsgIndices.length - 1] ?? -1
  const secondLastMsgUserIndex = userMsgIndices[userMsgIndices.length - 2] ?? -1

  // Apply caching if enabled (default: true)
  const enableCaching = options.enableCaching !== false
  const messagesWithCache = enableCaching
    ? applyCacheControlToMessages(formattedMessages, lastUserMsgIndex, secondLastMsgUserIndex)
    : formattedMessages

  // Prepare system message with caching
  const systemMessages = prepareSystemMessages(systemPrompt, enableCaching)

  const payload: ConverseStreamRequest = {
    inferenceConfig: {
      maxTokens: options.maxTokens || 8192,
      temperature: options.temperature || 0.0,
    },
    system: systemMessages,
    messages: messagesWithCache,
  }

  return fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  })
}
```

### 3.4 Stream Response Parsing

The converse-stream endpoint returns Server-Sent Events (SSE) in a specific format:

```typescript
interface ConverseStreamChunk {
  // Metadata with usage information
  metadata?: {
    usage: {
      inputTokens: number
      outputTokens: number
      cacheReadInputTokens?: number  // Tokens read from cache
      cacheWriteInputTokens?: number // Tokens written to cache
    }
  }

  // Content block delta
  contentBlockDelta?: {
    delta: {
      text?: string
      reasoningContent?: {
        text: string
      }
    }
  }
}

interface StreamYield {
  type: "text" | "reasoning" | "usage"
  text?: string
  reasoning?: string
  inputTokens?: number
  outputTokens?: number
  cacheReadTokens?: number
  cacheWriteTokens?: number
}

/**
 * Parse and process the converse-stream response
 */
async function* streamConverseResponse(response: Response): AsyncGenerator<StreamYield> {
  if (!response.body) {
    throw new Error("Response body is null")
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      const chunk = decoder.decode(value, { stream: true })
      const lines = chunk.split("\n").filter(Boolean)

      for (const line of lines) {
        if (line.startsWith("data: ")) {
          const jsonData = line.slice(6)

          try {
            // Parse using strict JSON (handle JavaScript object notation)
            const data = parseStrictJSON(jsonData)

            // Handle metadata (token usage)
            if (data.metadata?.usage) {
              let inputTokens = data.metadata.usage.inputTokens || 0
              const outputTokens = data.metadata.usage.outputTokens || 0

              const cacheReadInputTokens = data.metadata.usage.cacheReadInputTokens || 0
              const cacheWriteInputTokens = data.metadata.usage.cacheWriteInputTokens || 0

              // Total input tokens includes cached tokens
              inputTokens = inputTokens + cacheReadInputTokens + cacheWriteInputTokens

              yield {
                type: "usage",
                inputTokens,
                outputTokens,
                cacheReadTokens: cacheReadInputTokens,
                cacheWriteTokens: cacheWriteInputTokens,
              }
            }

            // Handle content block delta (text generation)
            if (data.contentBlockDelta) {
              if (data.contentBlockDelta?.delta?.text) {
                yield {
                  type: "text",
                  text: data.contentBlockDelta.delta.text,
                }
              }

              // Handle reasoning content if present (for Claude 3.7+)
              if (data.contentBlockDelta?.delta?.reasoningContent?.text) {
                yield {
                  type: "reasoning",
                  reasoning: data.contentBlockDelta.delta.reasoningContent.text,
                }
              }
            }
          } catch (error) {
            console.error("Failed to parse JSON data:", error)
          }
        }
      }
    }
  } finally {
    reader.releaseLock()
  }
}

/**
 * Parse JavaScript object notation as strict JSON
 * SAP AI Core may return JavaScript objects instead of strict JSON
 */
function parseStrictJSON(str: string): any {
  try {
    // First try standard JSON parse
    return JSON.parse(str)
  } catch {
    // Fall back to JavaScript evaluation (be careful with this in production!)
    // Wrap in parentheses to treat as expression
    const obj = new Function("return " + str)()
    return JSON.parse(JSON.stringify(obj))
  }
}
```

---

## 4. Complete Example Usage

```typescript
import { Buffer } from "buffer"

async function main() {
  // 1. Set up credentials
  const credentials = {
    clientId: "your-client-id",
    clientSecret: "your-client-secret",
    tokenUrl: "https://your-tenant.authentication.sap.hana.ondemand.com",
    baseUrl: "https://api.ai.ml.hana.ondemand.com",
    resourceGroup: "default",
  }

  // 2. Authenticate
  const tokenManager = new TokenManager()
  const accessToken = await tokenManager.getToken(credentials)

  // 3. Fetch deployments
  const deployments = await fetchDeployments(
    accessToken,
    credentials.baseUrl,
    credentials.resourceGroup
  )

  // 4. Find deployment for Claude 4 Sonnet
  const modelId = "anthropic--claude-4-sonnet"
  const deploymentId = findDeploymentForModel(deployments, modelId)

  if (!deploymentId) {
    throw new Error(`No deployment found for model ${modelId}`)
  }

  // 5. Prepare messages
  const systemPrompt = "You are a helpful AI assistant."
  const messages = [
    {
      role: "user" as const,
      content: "What is the capital of France?",
    },
  ]

  // 6. Create streaming request
  const response = await createConverseStreamRequest(
    accessToken,
    credentials.baseUrl,
    credentials.resourceGroup,
    deploymentId,
    systemPrompt,
    messages,
    {
      maxTokens: 8192,
      temperature: 0.0,
      enableCaching: true,
    }
  )

  // 7. Stream and process response
  let fullText = ""
  let usage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }

  for await (const chunk of streamConverseResponse(response)) {
    if (chunk.type === "text") {
      fullText += chunk.text
      process.stdout.write(chunk.text)
    } else if (chunk.type === "reasoning") {
      console.log("\n[Reasoning]:", chunk.reasoning)
    } else if (chunk.type === "usage") {
      usage = {
        inputTokens: chunk.inputTokens || usage.inputTokens,
        outputTokens: chunk.outputTokens || usage.outputTokens,
        cacheReadTokens: chunk.cacheReadTokens || usage.cacheReadTokens,
        cacheWriteTokens: chunk.cacheWriteTokens || usage.cacheWriteTokens,
      }
    }
  }

  console.log("\n\n[Usage]:", usage)
  console.log("\n[Full Response]:", fullText)
}

main().catch(console.error)
```

---

## 5. Supported Models

### Anthropic Models (with converse-stream support)

These models use the `converse-stream` endpoint with caching:

- `anthropic--claude-4.5-sonnet` - maxTokens: 8192, contextWindow: 200K, caching: ✓
- `anthropic--claude-4-sonnet` - maxTokens: 8192, contextWindow: 200K, caching: ✓
- `anthropic--claude-4-opus` - maxTokens: 8192, contextWindow: 200K, caching: ✓
- `anthropic--claude-3.7-sonnet` - maxTokens: 64K, contextWindow: 200K, caching: ✓

### Anthropic Models (with invoke-with-response-stream)

These older models use the `invoke-with-response-stream` endpoint without caching:

- `anthropic--claude-3.5-sonnet` - maxTokens: 8192, contextWindow: 200K
- `anthropic--claude-3-sonnet` - maxTokens: 4096, contextWindow: 200K
- `anthropic--claude-3-haiku` - maxTokens: 4096, contextWindow: 200K
- `anthropic--claude-3-opus` - maxTokens: 4096, contextWindow: 200K

### Other Supported Models

SAP AI Core also supports:
- **OpenAI GPT models**: gpt-4, gpt-4o, gpt-4o-mini, o1, o3, o3-mini, o4-mini, gpt-5, etc.
- **Google Gemini models**: gemini-2.5-pro, gemini-2.5-flash

---

## 6. Error Handling

```typescript
class SapAiCoreError extends Error {
  constructor(
    message: string,
    public statusCode?: number,
    public responseData?: any
  ) {
    super(message)
    this.name = "SapAiCoreError"
  }
}

async function handleApiError(response: Response): Promise<never> {
  const statusCode = response.status
  let responseData: any

  try {
    responseData = await response.json()
  } catch {
    responseData = await response.text()
  }

  switch (statusCode) {
    case 401:
      throw new SapAiCoreError("Authentication failed. Check your credentials.", statusCode, responseData)
    case 404:
      throw new SapAiCoreError("Deployment not found. Check your deployment ID.", statusCode, responseData)
    case 429:
      throw new SapAiCoreError("Rate limit exceeded. Please retry later.", statusCode, responseData)
    case 500:
      throw new SapAiCoreError("Internal server error on SAP AI Core.", statusCode, responseData)
    default:
      throw new SapAiCoreError(`API request failed with status ${statusCode}`, statusCode, responseData)
  }
}

// Use in request:
const response = await createConverseStreamRequest(...)
if (!response.ok) {
  await handleApiError(response)
}
```

---

## 7. Testing

```typescript
// Test authentication
async function testAuth() {
  const credentials = { /* your credentials */ }
  const tokenManager = new TokenManager()
  const token = await tokenManager.getToken(credentials)
  console.log("✓ Authentication successful")
  return token
}

// Test deployment fetching
async function testDeployments() {
  const token = await testAuth()
  const deployments = await fetchDeployments(token, credentials.baseUrl, credentials.resourceGroup)
  console.log("✓ Deployments fetched:", deployments.length)
  return deployments
}

// Test streaming
async function testStreaming() {
  const token = await testAuth()
  const deployments = await testDeployments()
  const deploymentId = findDeploymentForModel(deployments, "anthropic--claude-4-sonnet")

  const response = await createConverseStreamRequest(
    token,
    credentials.baseUrl,
    credentials.resourceGroup,
    deploymentId!,
    "You are a helpful assistant.",
    [{ role: "user", content: "Say hello!" }],
    { maxTokens: 100 }
  )

  let textReceived = false
  for await (const chunk of streamConverseResponse(response)) {
    if (chunk.type === "text") {
      textReceived = true
      console.log("✓ Received text:", chunk.text)
    }
  }

  if (!textReceived) {
    throw new Error("No text received from stream")
  }
}
```

---

## 8. Integration with LiteLLM

To integrate this into LiteLLM, you would need to:

1. **Add a new provider** in `litellm/llms/sapaicore.py`
2. **Implement the streaming interface** following LiteLLM's conventions
3. **Add model definitions** to `litellm/model_prices_and_context_window.json`
4. **Add authentication** to handle OAuth 2.0 flow
5. **Add deployment management** to map model names to deployment IDs

### Suggested LiteLLM Provider Structure

```python
# litellm/llms/sapaicore.py

from typing import Optional, AsyncGenerator
import aiohttp
import json

class SapAiCoreProvider:
    def __init__(
        self,
        client_id: str,
        client_secret: str,
        token_url: str,
        base_url: str,
        resource_group: str = "default"
    ):
        self.client_id = client_id
        self.client_secret = client_secret
        self.token_url = token_url
        self.base_url = base_url
        self.resource_group = resource_group
        self.token: Optional[dict] = None

    async def get_token(self) -> str:
        """Get or refresh access token"""
        if self.token and self.token["expires_at"] > time.time():
            return self.token["access_token"]

        async with aiohttp.ClientSession() as session:
            data = {
                "grant_type": "client_credentials",
                "client_id": self.client_id,
                "client_secret": self.client_secret,
            }

            url = self.token_url.rstrip("/") + "/oauth/token"

            async with session.post(
                url,
                data=data,
                headers={"Content-Type": "application/x-www-form-urlencoded"}
            ) as resp:
                token_data = await resp.json()
                token_data["expires_at"] = time.time() + token_data["expires_in"]
                self.token = token_data
                return token_data["access_token"]

    async def completion_stream(
        self,
        model: str,
        messages: list,
        deployment_id: str,
        **kwargs
    ) -> AsyncGenerator:
        """Stream completion from SAP AI Core"""
        token = await self.get_token()

        # Format messages for converse API
        formatted_messages = self._format_messages(messages)

        # Apply caching
        messages_with_cache = self._apply_caching(formatted_messages)

        # Prepare payload
        payload = {
            "inferenceConfig": {
                "maxTokens": kwargs.get("max_tokens", 8192),
                "temperature": kwargs.get("temperature", 0.0),
            },
            "system": self._prepare_system(kwargs.get("system", "")),
            "messages": messages_with_cache,
        }

        # Make streaming request
        url = f"{self.base_url}/v2/inference/deployments/{deployment_id}/converse-stream"
        headers = {
            "Authorization": f"Bearer {token}",
            "AI-Resource-Group": self.resource_group,
            "Content-Type": "application/json",
            "AI-Client-Type": "LiteLLM",
        }

        async with aiohttp.ClientSession() as session:
            async with session.post(url, json=payload, headers=headers) as resp:
                async for chunk in self._stream_response(resp):
                    yield chunk

    def _format_messages(self, messages: list) -> list:
        """Format messages for Bedrock Converse API"""
        # Implementation here
        pass

    def _apply_caching(self, messages: list) -> list:
        """Apply cache points to messages"""
        # Implementation here
        pass

    async def _stream_response(self, response) -> AsyncGenerator:
        """Parse SSE stream"""
        async for line in response.content:
            line = line.decode("utf-8").strip()
            if line.startswith("data: "):
                data = json.loads(line[6:])
                yield self._parse_chunk(data)
```

---

## 9. Key Differences from Standard Anthropic API

1. **Endpoint**: Uses SAP AI Core's `/converse-stream` endpoint instead of Anthropic's native API
2. **Authentication**: OAuth 2.0 client credentials instead of API keys
3. **Deployment IDs**: Requires deployment ID instead of model name
4. **Caching Format**: Uses AWS Bedrock's `cachePoint` objects instead of Anthropic's `cache_control`
5. **Message Format**: Uses Bedrock's Converse API format
6. **Response Format**: Different SSE structure with `contentBlockDelta` and `metadata`

---

## 10. References

- **Cline Implementation**: See `src/core/api/providers/sapaicore.ts`
- **SAP AI Core Documentation**: https://help.sap.com/docs/sap-ai-core
- **AWS Bedrock Converse API**: https://docs.aws.amazon.com/bedrock/latest/userguide/conversation-inference.html

---

## Summary

This implementation provides full support for SAP AI Core's Anthropic converse-stream API with:
- ✅ OAuth 2.0 authentication
- ✅ Deployment management
- ✅ Message formatting for Bedrock Converse API
- ✅ Prompt caching with cachePoint objects
- ✅ Streaming response parsing
- ✅ Support for text, images, and reasoning content
- ✅ Token usage tracking (including cache metrics)
- ✅ Error handling

The implementation can be adapted for LiteLLM by following the provider pattern and integrating with LiteLLM's existing streaming and authentication infrastructure.
