# Quantrel API Compatibility Checklist

Run these checks against your Quantrel backend to determine the best integration approach.

---

## ✅ Check 1: API Format Compatibility

**Test:** Can Quantrel accept requests in Anthropic's format?

```bash
curl -X POST http://localhost:8080/api/... \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "claude-3-5-sonnet-20241022",
    "max_tokens": 1024,
    "messages": [
      {"role": "user", "content": "Hello"}
    ]
  }'
```

**Expected:** Does it understand this format, or does it require a different schema?

- [ ] ✅ Accepts Anthropic format as-is
- [ ] ⚠️ Requires transformation (e.g., different field names)
- [ ] ❌ Uses completely different format

---

## ✅ Check 2: Response Format

**Test:** Does Quantrel return responses in Anthropic's format?

**Anthropic's format:**
```json
{
  "id": "msg_123",
  "type": "message",
  "role": "assistant",
  "content": [{"type": "text", "text": "Hello!"}],
  "model": "claude-3-5-sonnet-20241022",
  "usage": {"input_tokens": 10, "output_tokens": 20}
}
```

**Check what Quantrel returns:**
- [ ] ✅ Matches Anthropic format exactly
- [ ] ⚠️ Similar but needs transformation
- [ ] ❌ Completely different format

---

## ✅ Check 3: Streaming Support

**Test:** Does Quantrel stream in SSE format compatible with Anthropic?

**Anthropic's SSE format:**
```
event: message_start
data: {"type":"message_start","message":{"id":"msg_123",...}}

event: content_block_delta
data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Hello"}}

event: message_delta
data: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":20}}

event: message_stop
data: {"type":"message_stop"}
```

**Check Quantrel's streaming:**
- [ ] ✅ Uses same SSE event types and format
- [ ] ⚠️ Uses SSE but different event structure (e.g., `data: {"delta": "text"}`)
- [ ] ❌ No streaming support

---

## ✅ Check 4: Tool/Function Calling

**Test:** Does Quantrel support Claude's tool use format?

```bash
curl -X POST http://localhost:8080/api/... \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "claude-3-5-sonnet-20241022",
    "max_tokens": 1024,
    "tools": [
      {
        "name": "get_weather",
        "description": "Get weather data",
        "input_schema": {
          "type": "object",
          "properties": {"location": {"type": "string"}},
          "required": ["location"]
        }
      }
    ],
    "messages": [{"role": "user", "content": "What is the weather in NYC?"}]
  }'
```

**Expected response should include:**
```json
{
  "content": [
    {
      "type": "tool_use",
      "id": "toolu_123",
      "name": "get_weather",
      "input": {"location": "NYC"}
    }
  ]
}
```

- [ ] ✅ Supports tool calling in Anthropic format
- [ ] ⚠️ Supports tools but different format
- [ ] ❌ No tool calling support

---

## ✅ Check 5: Vision/Image Support

**Test:** Can Quantrel handle image inputs?

```bash
curl -X POST http://localhost:8080/api/... \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "claude-3-5-sonnet-20241022",
    "max_tokens": 1024,
    "messages": [
      {
        "role": "user",
        "content": [
          {"type": "text", "text": "What is in this image?"},
          {
            "type": "image",
            "source": {
              "type": "base64",
              "media_type": "image/jpeg",
              "data": "BASE64_IMAGE_DATA_HERE"
            }
          }
        ]
      }
    ]
  }'
```

- [ ] ✅ Supports images in Anthropic format
- [ ] ⚠️ Supports images but different format
- [ ] ❌ No image support

---

## ✅ Check 6: Multi-Provider Support

**Test:** Can Quantrel proxy to different providers?

Try the same request with different model IDs:
- `claude-3-5-sonnet-20241022` (Anthropic)
- `gpt-4o` (OpenAI)
- `gemini-2.0-flash-exp` (Google)

**Questions:**
- [ ] Does Quantrel automatically route to the right provider based on model ID?
- [ ] Do all providers return responses in the same format?
- [ ] Can you use the same authentication for all models?

---

## ✅ Check 7: Error Handling

**Test:** What errors does Quantrel return?

Try these scenarios:
1. **Invalid token:** Use an expired/wrong JWT
2. **Invalid model:** Request a non-existent model
3. **Insufficient credits:** (if applicable)
4. **Rate limiting:** Make many requests quickly

**Check error format:**
```json
{
  "error": {
    "type": "authentication_error",
    "message": "Invalid token"
  }
}
```

- [ ] ✅ Uses Anthropic-style error format
- [ ] ⚠️ Different error format
- [ ] ❌ No structured errors

---
