# Gemini Integration Architecture

This document provides a comprehensive overview of the Google Gemini API integration in the Cline extension.

## Table of Contents

- [Overview](#overview)
- [Architecture](#architecture)
- [Usage](#usage)
- [Testing](#testing)
- [Troubleshooting](#troubleshooting)
- [Known Issues](#known-issues)

## Overview

The Gemini integration allows users to leverage Google's Gemini models through the Cline extension. This integration adapts Gemini's API to work with the extension's architecture, which is primarily designed for Anthropic's Claude models.

Key features:
- Support for multiple Gemini model variants
- System prompt handling
- Streaming responses
- Image input processing
- Error handling for safety filters and rate limits

## Architecture

The integration is built around several key components:

### GeminiHandler

The `GeminiHandler` class (`src/api/providers/gemini.ts`) is the main entry point for interacting with Gemini models. It implements the `ApiHandler` interface used throughout the application, allowing Gemini to be a drop-in replacement for other LLM providers.

Key methods:
- `createMessage`: Generates content using Gemini models based on a system prompt and messages
- `getModel`: Retrieves model information based on configuration

### Format Transformation

The `src/api/transform/gemini-format.ts` module contains functions to convert between Anthropic's message format and Gemini's content format:

- `convertAnthropicMessageToGemini`: Converts Anthropic-style messages to Gemini format
- `convertAnthropicContentToGemini`: Converts Anthropic content blocks to Gemini parts
- `unescapeGeminiContent`: Processes escaped characters in Gemini responses
- `convertGeminiResponseToAnthropic`: Transforms Gemini responses to Anthropic format

### Models Configuration

Model information is defined in `src/shared/api.ts`, including:
- Model IDs
- Token limits
- Cost information
- Default model selection

## Usage

### Basic Usage

To use Gemini models in your code:

```typescript
import { GeminiHandler } from "../api/providers/gemini";

// Create a handler
const handler = new GeminiHandler({
  geminiApiKey: "YOUR_API_KEY",
  apiModelId: "gemini-1.5-pro-002" // Optional: specify a model
});

// Generate a response
async function generateResponse() {
  const systemPrompt = "You are a helpful assistant.";
  const messages = [{ role: "user", content: "Hello, who are you?" }];

  for await (const chunk of handler.createMessage(systemPrompt, messages)) {
    if (chunk.type === "text") {
      console.log(chunk.text); // Process text chunks
    } else if (chunk.type === "usage") {
      console.log(`Input tokens: ${chunk.inputTokens}, Output tokens: ${chunk.outputTokens}`);
    }
  }
}
```

### Working with Images

Gemini models support image input:

```typescript
// Message with image
const message = {
  role: "user",
  content: [
    { type: "text", text: "What's in this image?" },
    {
      type: "image",
      source: {
        type: "base64",
        media_type: "image/jpeg",
        data: "base64EncodedImageData",
      },
    },
  ],
};

// Use the handler to process this image
for await (const chunk of handler.createMessage("Describe the image", [message])) {
  // Process response chunks
}
```

### Configuration Options

When creating a `GeminiHandler`, you can specify:

- `geminiApiKey`: (Required) Your Google AI API key
- `apiModelId`: (Optional) Specific Gemini model ID to use
- Additional options inherited from `ApiHandlerOptions`

## Testing

### Automated Tests

The integration includes several test suites:

1. **Format Tests**: Located in `src/test/api/transform/gemini-format.test.ts`, these verify the transformation functions work correctly.

2. **Handler Tests**: Located in `src/test/api/providers/gemini.test.ts`, these test the `GeminiHandler` functionality, including error handling and integration with the Gemini API.

3. **Mock Utilities**: Located in `src/test/utils/gemini-mocks.ts`, these provide mock implementations for testing without calling the actual API.

### Manual Testing

A standalone script for manual testing is available at `src/test/manual/gemini-test.js`. This script provides an interactive environment to test the Gemini integration:

```bash
# Set your API key
export GEMINI_API_KEY="your-api-key"

# Run the test script
node src/test/manual/gemini-test.js
```

The script allows you to:
- Send text messages to Gemini
- Upload and process images
- View token usage information

## Troubleshooting

### Common Issues

1. **Authentication Errors**
   - Ensure your API key is valid and has access to Gemini models
   - Verify the API key is passed correctly to the `GeminiHandler`

2. **Rate Limiting**
   - The integration includes retry logic for rate limit errors
   - If you encounter persistent rate limiting, reduce request frequency

3. **Safety Filters**
   - Gemini has built-in safety filters that may block certain requests
   - The `GeminiHandler` throws specific errors when content is blocked for safety reasons

4. **UNC Path Handling on Windows**
   - Special handling is implemented for Windows UNC paths in `unescapeGeminiContent`
   - This prevents backslashes in Windows paths from being incorrectly processed

### Debugging Tips

1. **Enable Verbose Logging**
   - Set the `VSCODE_DEBUG_MODE` environment variable to enable more detailed logs

2. **Check Response Structure**
   - Gemini's response format is different from Anthropic's
   - Verify that transformations are handling all fields correctly

3. **Test with Simple Prompts**
   - When debugging, start with simple text-only prompts before testing more complex features

## Known Issues

1. **System Prompt Handling**
   - The way Gemini handles system prompts differs from Anthropic models
   - In some cases, the system prompt may have less influence on Gemini models

2. **Image Format Limitations**
   - Gemini currently only supports a limited set of image formats (JPEG, PNG, etc.)
   - Very large images may need resizing before processing

3. **Test Suite Failures**
   - Some integration tests may occasionally fail due to timing issues with async generators
   - These are marked with `it.skip()` in the test files

4. **Model Configuration Updates**
   - As Google adds new Gemini model versions, the model configuration in `shared/api.ts` may need updating

---

For further assistance, please file an issue on the project repository or contact the maintainers. 