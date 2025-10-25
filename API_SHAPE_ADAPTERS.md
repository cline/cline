z# API Shape Adapters in Cline

## Overview

Cline uses **API shape adapters** to provide a unified interface for working with different AI provider APIs. These adapters transform data between Cline's internal format (based on Anthropic's message structure) and the specific formats required by various AI providers (OpenAI, Gemini, etc.).

## Why API Shape Adapters?

Different AI providers use different API formats:

- **Anthropic**: Uses `messages` with `content` blocks (text, image, tool_use, tool_result)
- **OpenAI**: Uses `messages` with `role` and `content`, separate `tool_calls` array
- **Gemini**: Uses `contents` with `parts` (text, inlineData, functionCall, functionResponse)
- **Others**: Each has unique structures and conventions

Rather than maintaining separate code paths for each provider, Cline:
1. Uses **Anthropic's format as the internal standard** (stored in conversation history)
2. **Transforms to/from provider-specific formats** when making API calls
3. **Normalizes responses back to Anthropic format** for consistent processing

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Cline Core (Task)                        │
│                                                             │
│  Internal Format: Anthropic Message Structure               │
│  - messages: MessageParam[]                                 │
│  - content: ContentBlock[] (text, image, tool_use, etc.)   │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                   API Provider Layer                        │
│                                                             │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐     │
│  │  Anthropic   │  │   OpenAI     │  │   Gemini     │     │
│  │   Handler    │  │   Handler    │  │   Handler    │     │
│  └──────────────┘  └──────────────┘  └──────────────┘     │
│         │                 │                  │              │
│         │                 │                  │              │
│    (no adapter)     (uses adapters)    (uses adapters)     │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│              Format Transformation Layer                    │
│                                                             │
│  src/core/api/transform/                                    │
│  ├── anthropic-format.ts  (OpenAI → Anthropic tools)       │
│  ├── openai-format.ts     (Anthropic → OpenAI messages)    │
│  ├── gemini-format.ts     (Anthropic → Gemini content)     │
│  ├── ollama-format.ts     (Anthropic → Ollama messages)    │
│  ├── mistral-format.ts    (Anthropic → Mistral messages)   │
│  ├── o1-format.ts         (Special handling for O1 models) │
│  └── r1-format.ts         (Special handling for R1 models) │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                  External API Providers                     │
│                                                             │
│  Anthropic API    OpenAI API    Gemini API    etc.         │
└─────────────────────────────────────────────────────────────┘
```

## Key Adapter Files

### 1. `anthropic-format.ts`
**Purpose**: Convert OpenAI tool definitions to Anthropic format

```typescript
// OpenAI tool format
{
  type: "function",
  function: {
    name: "read_file",
    description: "Read a file",
    parameters: {
      type: "object",
      properties: { path: { type: "string" } },
      required: ["path"]
    }
  }
}

// Converts to Anthropic tool format
{
  name: "read_file",
  description: "Read a file",
  input_schema: {
    type: "object",
    properties: { path: { type: "string" } },
    required: ["path"]
  }
}
```

**Key Function**: `openAIToolToAnthropic(openAITool: OpenAITool): AnthropicTool`

### 2. `openai-format.ts`
**Purpose**: Bidirectional conversion between Anthropic and OpenAI message formats

#### Request Transformation (Anthropic → OpenAI)

```typescript
// Anthropic format (internal)
{
  role: "user",
  content: [
    { type: "text", text: "Hello" },
    { type: "image", source: { type: "base64", data: "...", media_type: "image/png" } },
    { type: "tool_result", tool_use_id: "123", content: "Result" }
  ]
}

// Converts to OpenAI format
{
  role: "user",
  content: [
    { type: "text", text: "Hello" },
    { type: "image_url", image_url: { url: "data:image/png;base64,..." } }
  ]
}
// Tool results become separate messages
{
  role: "tool",
  tool_call_id: "123",
  content: "Result"
}
```

**Key Functions**:
- `convertToOpenAiMessages(anthropicMessages)`: Converts message history for API requests
- `convertToAnthropicMessage(completion)`: Converts API responses back to internal format

#### Response Transformation (OpenAI → Anthropic)

```typescript
// OpenAI response
{
  choices: [{
    message: {
      role: "assistant",
      content: "Here's the result",
      tool_calls: [{
        id: "call_123",
        type: "function",
        function: { name: "read_file", arguments: '{"path":"file.txt"}' }
      }]
    }
  }]
}

// Converts to Anthropic format
{
  role: "assistant",
  content: [
    { type: "text", text: "Here's the result" },
    { type: "tool_use", id: "call_123", name: "read_file", input: { path: "file.txt" } }
  ]
}
```

### 3. `gemini-format.ts`
**Purpose**: Convert between Anthropic and Gemini formats

```typescript
// Anthropic format
{
  role: "user",
  content: [
    { type: "text", text: "Hello" },
    { type: "tool_result", tool_use_id: "123", content: "Result" }
  ]
}

// Converts to Gemini format
{
  role: "user",
  parts: [
    { text: "Hello" },
    { functionResponse: { name: "123", response: { result: "Result" } } }
  ]
}
```

**Key Functions**:
- `convertAnthropicContentToGemini(content)`: Converts content blocks to Gemini parts
- `convertAnthropicMessageToGemini(message)`: Converts full messages
- `convertGeminiResponseToAnthropic(response)`: Converts responses back
- `unescapeGeminiContent(content)`: Fixes Gemini's double-escaping issue

### 4. Special Model Adapters

#### `o1-format.ts` (OpenAI O1 Models)
O1 models have unique requirements:
- No system prompts (must be in user message)
- No streaming support
- No temperature control
- Different reasoning token handling

#### `r1-format.ts` (DeepSeek R1 Models)
R1 models require:
- Special reasoning block handling
- Different message structure
- Specific prompt formatting

## How Adapters Are Used

### Example: OpenRouter Provider

```typescript
// src/core/api/providers/openrouter.ts
import { convertToOpenAiMessages, convertToAnthropicMessage } from "../transform/openai-format"

class OpenRouterHandler {
  async *createMessage(systemPrompt, messages, tools) {
    // 1. Convert internal Anthropic format to OpenAI format
    const openAiMessages = convertToOpenAiMessages(messages)
    
    // 2. Make API request with OpenAI format
    const stream = await this.client.chat.completions.create({
      model: this.modelId,
      messages: [
        { role: "system", content: systemPrompt },
        ...openAiMessages
      ],
      tools: tools,
      stream: true
    })
    
    // 3. Stream response chunks
    for await (const chunk of stream) {
      // Yield chunks in a normalized format
      yield { type: "text", text: chunk.choices[0]?.delta?.content }
    }
    
    // 4. Convert final response back to Anthropic format (if needed)
    // This happens in the streaming handler
  }
}
```

### Example: Gemini Provider

```typescript
// src/core/api/providers/gemini.ts
import { 
  convertAnthropicMessageToGemini,
  convertGeminiResponseToAnthropic 
} from "../transform/gemini-format"

class GeminiHandler {
  async *createMessage(systemPrompt, messages, tools) {
    // 1. Convert messages to Gemini format
    const geminiMessages = messages.map(convertAnthropicMessageToGemini)
    
    // 2. Make API request
    const result = await this.model.generateContentStream({
      contents: geminiMessages,
      systemInstruction: systemPrompt,
      tools: tools
    })
    
    // 3. Stream and convert response
    for await (const chunk of result.stream) {
      yield { type: "text", text: chunk.text() }
    }
  }
}
```

## Streaming Response Normalization

All providers yield chunks in a normalized format:

```typescript
// Normalized chunk types
type ApiStreamChunk = 
  | { type: "text", text: string }
  | { type: "tool_calls", tool_call: ToolCall }
  | { type: "usage", inputTokens: number, outputTokens: number }
  | { type: "reasoning", reasoning: string }
  | { type: "ant_thinking", thinking: string, signature: string }
```

This allows the Task class to process responses uniformly regardless of provider.

## Tool Handling

### Tool Definition Conversion

```typescript
// Cline's internal tool definition (OpenAI-compatible)
const clineTools: ClineTool[] = [
  {
    type: "function",
    function: {
      name: "read_file",
      description: "Read a file",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "File path" }
        },
        required: ["path"]
      }
    }
  }
]

// For Anthropic API - use directly (native format)
// For OpenAI API - use directly (native format)
// For Gemini API - convert to function declarations
// For others - adapt as needed
```

### Tool Call/Result Flow

1. **AI makes tool call** (provider-specific format)
2. **Adapter converts to Anthropic format** (tool_use block)
3. **Cline executes tool** (internal processing)
4. **Result stored in Anthropic format** (tool_result block)
5. **Adapter converts back to provider format** when sending next request

## Benefits of This Architecture

1. **Single Source of Truth**: Conversation history stored in one consistent format
2. **Provider Flexibility**: Easy to add new providers by creating adapters
3. **Maintainability**: Changes to internal logic don't affect provider integrations
4. **Testing**: Can test adapters independently from business logic
5. **Consistency**: All providers behave the same way from Cline's perspective

## Special Considerations

### Prompt Caching

Different providers handle caching differently:
- **Anthropic**: Explicit `cache_control` blocks
- **OpenAI**: Automatic caching based on message structure
- **Gemini**: Context caching API
- **Others**: May not support caching

Adapters handle these differences transparently.

### Image Handling

```typescript
// Anthropic format (internal)
{
  type: "image",
  source: {
    type: "base64",
    media_type: "image/png",
    data: "iVBORw0KG..."
  }
}

// OpenAI format
{
  type: "image_url",
  image_url: {
    url: "data:image/png;base64,iVBORw0KG..."
  }
}

// Gemini format
{
  inlineData: {
    mimeType: "image/png",
    data: "iVBORw0KG..."
  }
}
```

### Reasoning/Thinking Tokens

Different providers expose reasoning differently:
- **Anthropic**: `thinking` blocks with signatures
- **OpenAI O1**: Reasoning tokens in usage
- **DeepSeek R1**: Special reasoning format
- **Gemini**: Thinking budget configuration

Adapters normalize these into a common `reasoning` chunk type.

## Adding a New Provider

To add support for a new AI provider:

1. **Create adapter file** in `src/core/api/transform/`
   ```typescript
   // new-provider-format.ts
   export function convertToNewProviderMessages(anthropicMessages) { ... }
   export function convertFromNewProviderResponse(response) { ... }
   ```

2. **Create provider handler** in `src/core/api/providers/`
   ```typescript
   // new-provider.ts
   import { convertToNewProviderMessages } from "../transform/new-provider-format"
   
   export class NewProviderHandler implements ApiHandler {
     async *createMessage(systemPrompt, messages, tools) {
       const providerMessages = convertToNewProviderMessages(messages)
       // Make API call and stream response
     }
   }
   ```

3. **Register provider** in configuration
4. **Add model definitions** to `src/shared/api.ts`

## Conclusion

API shape adapters are a crucial abstraction layer in Cline that:
- Enable support for multiple AI providers
- Maintain a consistent internal data model
- Simplify provider integration
- Allow transparent handling of provider-specific features

By using Anthropic's message format as the internal standard and adapting to/from other formats at the API boundary, Cline achieves both flexibility and maintainability.
