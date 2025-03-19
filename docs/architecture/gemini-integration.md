# Google Gemini Integration

This document describes the integration of Google's Gemini API into the Cline extension. The implementation adapts Gemini's API to work with Cline's Anthropic-compatible architecture, allowing seamless use of Gemini models within the application.

## Overview

The Gemini integration consists of the following key components:

1. **GeminiHandler**: The main class that implements the `ApiHandler` interface, providing methods for message generation and model selection.
2. **Format Conversion Utilities**: Functions for converting between Anthropic's message format and Gemini's content format.
3. **Model Definitions**: Configuration for various Gemini models including their capabilities and limitations.

## GeminiHandler

The `GeminiHandler` class serves as the primary interface for interacting with Google's Gemini API. It implements the common `ApiHandler` interface used throughout Cline, allowing the extension to use Gemini models interchangeably with other providers like Anthropic Claude and OpenAI.

### Key Features

- **Streaming Responses**: Provides real-time streaming of model outputs, yielding text chunks as they're generated.
- **Error Handling**: Robust error handling for various Gemini-specific error conditions including safety filters, recitation detection, and general API errors.
- **Retry Logic**: Uses the `@withRetry` decorator to automatically retry failed requests with exponential backoff.
- **Usage Tracking**: Reports token usage for both input and output, enabling cost tracking and monitoring.

### Usage Example

```typescript
import { GeminiHandler } from "../api/providers/gemini"
import { Anthropic } from "@anthropic-ai/sdk"

// Initialize the handler with API key
const handler = new GeminiHandler({ 
  geminiApiKey: "YOUR_API_KEY",
  apiModelId: "gemini-1.5-pro-002" // Optional: specify a model
})

// Create a system prompt and messages
const systemPrompt = "You are a helpful AI assistant that answers questions accurately and concisely."
const messages: Anthropic.Messages.MessageParam[] = [
  { role: "user", content: "What is the capital of France?" }
]

// Generate a response (streaming)
async function generateResponse() {
  for await (const chunk of handler.createMessage(systemPrompt, messages)) {
    if (chunk.type === "text") {
      console.log(chunk.text)
    } else if (chunk.type === "usage") {
      console.log(`Input tokens: ${chunk.inputTokens}, Output tokens: ${chunk.outputTokens}`)
    }
  }
}
```

## Format Conversion

The Gemini integration includes utilities for converting between Anthropic's message format and Gemini's content format. These converters handle the differences in structure and terminology between the two APIs.

### Key Converters

1. **convertAnthropicMessageToGemini**: Converts Anthropic's message format to Gemini's content format.
2. **convertAnthropicContentToGemini**: Converts Anthropic's content blocks to Gemini's part format.
3. **unescapeGeminiContent**: Fixes Gemini's double-escaping of special characters in responses.
4. **convertGeminiResponseToAnthropic**: Converts Gemini responses to Anthropic's message format.

### Content Type Support

The conversion utilities support the following content types:

- **Text**: Basic text messages are fully supported in both directions.
- **Images**: Image blocks in Anthropic messages are converted to Gemini's `inlineData` format (base64 only).
- **Finish Reasons**: Gemini's finish reasons are mapped to equivalent Anthropic stop reasons.

## Model Configuration

The integration includes definitions for various Gemini models, specifying their capabilities and limitations:

| Model ID | Max Tokens | Context Window | Images Support | Default |
|----------|------------|----------------|----------------|---------|
| gemini-2.0-flash-001 | 8,192 | 1,048,576 | Yes | Yes |
| gemini-1.5-pro-002 | 8,192 | 2,097,152 | Yes | No |
| *Additional models...* | ... | ... | ... | ... |

### Model Selection

The handler automatically selects the appropriate model based on the provided configuration:

1. If `apiModelId` is specified and valid, that model is used.
2. Otherwise, the default model (`gemini-2.0-flash-001`) is used.

## Error Handling

The Gemini integration handles several specific error conditions:

- **Safety Filters**: If content is blocked for safety reasons, an appropriate error is thrown.
- **Recitation Detection**: If content is blocked for potential copyright issues, a specific error is raised.
- **Stream Processing Errors**: Errors during stream processing are caught and propagated with contextual information.
- **Missing Response**: If no response is received from the API, a clear error is provided.

## Limitations and Considerations

When using the Gemini integration, be aware of the following limitations:

1. **Image Support**: Only base64-encoded images are supported. URL references are not supported.
2. **Prompt Caching**: Gemini models currently do not support prompt caching.
3. **Tool Use**: The current implementation does not support tool use or function calling features.
4. **Format Differences**: Some advanced features of Anthropic's API may not have direct equivalents in Gemini.

## Implementation Details

### Response Streaming

The implementation uses Gemini's streaming API to provide real-time text chunks. Each chunk is processed, unescaped to handle special characters, and yielded to the consumer.

### Token Usage Reporting

Token usage information is extracted from the response metadata and provided as a usage chunk after all text chunks have been processed. This enables accurate tracking of API costs.

### Special Character Handling

Gemini sometimes returns double-escaped characters in responses. The `unescapeGeminiContent` function normalizes these, handling:

- Newlines (`\n`), tabs (`\t`), and carriage returns (`\r`)
- Quotes (`"` and `'`)
- Windows paths with backslashes
- Other double-escaped sequences

## Future Improvements

Potential enhancements to the Gemini integration include:

1. Supporting tool use / function calling when Gemini offers compatible functionality
2. Implementing better prompt caching when supported by the API
3. Adding support for additional content types as they become available
4. Optimizing token usage for large context windows

## Troubleshooting

Common issues and their solutions:

1. **API Key Errors**: Ensure your API key is correctly configured in the options.
2. **Model Selection Errors**: Verify that the specified model ID is supported and spelled correctly.
3. **Content Filtering**: If responses are being blocked, review your prompts to ensure they comply with Gemini's content policy.
4. **Performance Issues**: For large responses, consider using a model with a higher token limit.

## References

- [Google Generative AI Documentation](https://ai.google.dev/docs)
- [Gemini API Models Reference](https://ai.google.dev/gemini-api/docs/models/gemini)
- [Content Generation with Gemini](https://ai.google.dev/gemini-api/docs/text-generation) 