# Complete Anthropic Tool Call Flow - Detailed Mermaid Diagram

This diagram shows the COMPLETE flow for Anthropic API tool calls, from request to execution and back.

```mermaid

```

## Key Points About Anthropic Flow

### 1. **Native Anthropic Format**
- Anthropic API uses its own streaming format (not OpenAI-compatible)
- Tool calls come as `content_block_start` with `type: 'tool_use'`
- Arguments stream as `input_json_delta` chunks

### 2. **Conversion to OpenAI Format**
The AnthropicHandler converts Anthropic's format to OpenAI-compatible format:
```typescript
// Anthropic format (from API)
{
  type: 'content_block_start',
  content_block: {
    type: 'tool_use',
    id: 'toolu_01A2B3C4D5',
    name: 'read_file'
  }
}

// Converted to OpenAI format (for internal use)
{
  type: 'tool_calls',
  tool_call: {
    id: 'toolu_01A2B3C4D5',
    type: 'function',
    function: {
      name: 'read_file',
      arguments: '{"path":"/src/app.ts"}'
    }
  }
}
```

### 3. **No ToolCallProcessor Needed**
- Anthropic already provides complete tool information in structured chunks
- No need to accumulate fragments like OpenAI
- AnthropicHandler directly yields tool_calls chunks

### 4. **ToolUseHandler Converts Back**
- Takes OpenAI-compatible format
- Converts to Anthropic.ToolUseBlockParam for API history
- Stores in proper Anthropic format for next request

### 5. **Tool Execution Uses JSON**
- ToolExecutor receives structured ToolUse object
- Executes based on JSON params (NOT XML)
- XML is only for UI display

### 6. **Complete Round Trip**
```
Anthropic API → AnthropicHandler (Anthropic→OpenAI) 
→ ToolUseHandler (OpenAI→Anthropic) 
→ Storage (Anthropic format) 
→ ToolExecutor (JSON execution) 
→ Tool Result (Anthropic format) 
→ Next API Request (Anthropic format)
```

## Format Summary

| Stage | Format | Purpose |
|-------|--------|---------|
| **Anthropic API Response** | Anthropic streaming events | Native API format |
| **AnthropicHandler Output** | OpenAI-compatible chunks | Internal standardization |
| **ToolUseHandler Storage** | Anthropic.ToolUseBlockParam | API conversation history |
| **AssistantMessageContent** | ToolUse objects (JSON) | Tool execution |
| **UI Display** | XML strings | Visual presentation |
| **Tool Result** | Anthropic.ToolResultBlockParam | Next API request |

## File Locations

- **AnthropicHandler**: `src/core/api/providers/anthropic.ts`
- **ToolUseHandler**: `src/core/api/transform/ToolUseHandler.ts`
- **Task**: `src/core/task/index.ts`
- **ToolExecutor**: `src/core/task/ToolExecutor.ts`
- **API History**: `~/.cline/tasks/{taskId}/api_conversation_history.json`
- **Cline Messages**: `~/.cline/tasks/{taskId}/cline_messages.json`
