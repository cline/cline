# Test Utility Documentation

This directory contains utilities to help write tests for the Cline application. These utilities include mock implementations of various APIs and helper functions for testing.

## Gemini Mock Utilities

The `gemini-mocks.ts` file provides utilities for mocking Google's Generative AI interfaces in tests. These mocks make it easier to test the Gemini API provider without making actual API calls.

### Quick Start

```typescript
import { createMockGeminiModel } from "../utils/gemini-mocks";
import { GeminiHandler } from "../../api/providers/gemini";

// Create a handler with API key (required for constructor)
const handler = new GeminiHandler({ geminiApiKey: "fake-key" });

// Create a mock model
const mockModel = createMockGeminiModel({
  textChunks: ["Hello, ", "world!"],
  promptTokens: 10,
  completionTokens: 5
});

// Inject the mock model into the handler
handler["client"] = {
  getGenerativeModel: () => mockModel
} as any;

// Now you can test the handler with controlled responses
const output = [];
for await (const chunk of handler.createMessage("System prompt", [{ role: "user", content: "Test" }])) {
  output.push(chunk);
}

// Verify output contains expected text and usage chunks
```

### Available Mocks

1. **`createMockGeminiResponse`** - Creates a mock `EnhancedGenerateContentResponse` object
2. **`createMockGeminiStream`** - Creates a mock stream and response for `generateContentStream`
3. **`createMockApiStream`** - Creates a mock `ApiStream` for direct testing of stream consumers
4. **`createMockGeminiModel`** - Creates a model object with mock content generation methods

### Common Testing Scenarios

#### Testing Successful Content Generation

```typescript
// Arrange
const handler = new GeminiHandler({ geminiApiKey: "fake-key" });
handler["client"] = {
  getGenerativeModel: () => createMockGeminiModel({
    textChunks: ["Hello, world!"],
    promptTokens: 5,
    completionTokens: 3
  })
} as any;

// Act
const chunks = [];
for await (const chunk of handler.createMessage("Prompt", [{ role: "user", content: "Hi" }])) {
  chunks.push(chunk);
}

// Assert
// Check text content and token usage
```

#### Testing Error Handling

```typescript
// Arrange - create a model that throws during stream processing
const handler = new GeminiHandler({ geminiApiKey: "fake-key" });
handler["client"] = {
  getGenerativeModel: () => createMockGeminiModel({
    streamError: new Error("API unavailable")
  })
} as any;

// Act & Assert
try {
  await handler.createMessage("Prompt", [{ role: "user", content: "Hi" }]).next();
  assert.fail("Should have thrown an error");
} catch (error) {
  // Verify error message or type
}
```

#### Testing Finish Reasons

```typescript
// Arrange - create a model that returns a specific finish reason
const handler = new GeminiHandler({ geminiApiKey: "fake-key" });
handler["client"] = {
  getGenerativeModel: () => createMockGeminiModel({
    textChunks: ["I cannot complete this request."],
    finishReason: "SAFETY"
  })
} as any;

// Act & Assert
try {
  await handler.createMessage("Prompt", [{ role: "user", content: "Hi" }]).next();
  // Continue consuming the generator to reach the error
} catch (error) {
  // Verify the error is about safety restrictions
}
```

## Other Test Utilities

The test directory also contains other utilities for mocking VS Code APIs and other services. These are important for creating isolated unit tests without real dependencies.

---

For more examples, see the `gemini-mocks.test.ts` file which demonstrates how to use these utilities in real test cases. 