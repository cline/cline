# Bedrock Parallel Tool Calling — Implementation Plan

## Simple Explanation

**What we're doing:** Adding tool calling (function calling) support for Amazon Bedrock in Cline, which will also enable parallel tool calling for Bedrock users.

**Why it doesn't work today:** Cline already has parallel tool calling working for Anthropic (direct API), OpenAI, and other providers. But for Amazon Bedrock, Cline's Bedrock handler never sends tool definitions to the Bedrock API and never reads tool call events from the Bedrock response stream. So even though Bedrock's Converse API fully supports tool calling, Cline ignores it entirely. The model falls back to XML-based tool calling in the text stream, which can only do one tool at a time.

**What we need to build:**
1. Send Cline's tool definitions to Bedrock in the request (via `toolConfig`)
2. Read tool call events from Bedrock's streaming response and translate them into Cline's internal format
3. Send tool results back to Bedrock properly in follow-up messages
4. Once those three pieces are in place, parallel tool calling works automatically via existing Cline infrastructure

**What we don't need to build:** The parallel execution runtime (Task + ToolExecutor) already exists. No new UI, settings, or CLI changes are required.

---

## Architecture Context

### How Cline's provider system works

```
src/shared/api.ts           ← Model catalogs + ApiProvider union type
src/core/api/index.ts       ← Factory: buildApiHandler() switches on provider
src/core/api/providers/     ← Individual handler implementations
src/core/task/index.ts      ← Task: orchestrates streaming + tool execution
src/core/task/ToolExecutor  ← Executes tool blocks, handles parallel gating
```

### How the Anthropic direct handler does tool calling (reference)

File: `src/core/api/providers/anthropic.ts`

1. **Request:** Passes `tools` array to `client.messages.create()`
2. **Stream parsing:** On `content_block_start` with `type: tool_use`, captures `{id, name}`. On `content_block_delta` with `type: input_json_delta`, yields `ApiStreamToolCallsChunk`.
3. **Result:** Task sees `type: "tool_calls"` chunks, executes tools, sends results back.

### How the Bedrock handler works today (no tool calling)

File: `src/core/api/providers/bedrock.ts`

1. **Request:** Uses `ConverseStreamCommand` with `modelId`, `messages`, `system`, `inferenceConfig`, `additionalModelRequestFields`. No `toolConfig`.
2. **Stream parsing:** `executeConverseStream()` handles `text`, `reasoning`, `usage`, and errors. Ignores `toolUse` events entirely.
3. **Message formatting:** `formatMessagesForConverseAPI()` maps `text` and `image` content blocks. Ignores `tool_use` and `tool_result` blocks.

### Bedrock ConverseStream API (from AWS SDK types)

**Request shape:**
```typescript
ConverseStreamCommand({
  modelId,
  messages,
  system,
  inferenceConfig,
  toolConfig: {                    // ← NEW: we need to add this
    tools: [
      { toolSpec: { name, description, inputSchema: { json: schemaObj } } }
    ],
    toolChoice: { auto: {} }       // or { any: {} } to force tool use
  },
  additionalModelRequestFields,
})
```

**Stream events for tool use:**
```
contentBlockStart → { start: { toolUse: { toolUseId, name, type? } }, contentBlockIndex }
contentBlockDelta → { delta: { toolUse: { input: "partial JSON string" } }, contentBlockIndex }
contentBlockStop  → { contentBlockIndex }
messageStop       → { stopReason: "tool_use" | "end_turn" | ... }
```

**Message content blocks for tool results (user → model):**
```typescript
{
  role: "user",
  content: [
    { toolResult: { toolUseId, content: [{ text: "..." }], status: "success" | "error" } }
  ]
}
```

### Cline internal stream chunk for tool calls

File: `src/core/api/transform/stream.ts`

```typescript
interface ApiStreamToolCallsChunk {
  type: "tool_calls"
  tool_call: {
    call_id?: string
    function: { id?: string, name?: string, arguments?: any }
  }
}
```

---

## Implementation Plan — Task Checklist

### Phase 1: Core plumbing — Accept tools in Bedrock handler

- [ ] **1.1** Update `AwsBedrockHandler.createMessage()` signature to accept optional `tools` parameter
  - File: `src/core/api/providers/bedrock.ts`
  - Change: `async *createMessage(systemPrompt: string, messages: ClineStorageMessage[], tools?: any[]): ApiStream`
  - The `tools` parameter will be Anthropic-format tool definitions (same as what `AnthropicHandler` receives)

- [ ] **1.2** Create a tool definition mapper function: `mapClineToolsToBedrockToolConfig()`
  - File: `src/core/api/providers/bedrock.ts` (private method or standalone function)
  - Input: Cline/Anthropic tool definitions `Array<{ name, description, input_schema }>`
  - Output: Bedrock `ToolConfiguration` object:
    ```typescript
    {
      tools: [{ toolSpec: { name, description, inputSchema: { json: schema } } }],
      toolChoice: { auto: {} }
    }
    ```
  - Handle edge case: when `tools` is empty/undefined, return `undefined` (no toolConfig)

- [ ] **1.3** Pass `toolConfig` into the `ConverseStreamCommand` in `createAnthropicMessage()`
  - File: `src/core/api/providers/bedrock.ts`, method `createAnthropicMessage()`
  - Thread the `tools` parameter from `createMessage()` → `createAnthropicMessage()`
  - Build `toolConfig` using mapper from 1.2
  - Add to command: `new ConverseStreamCommand({ ..., toolConfig })`
  - Important: When thinking/reasoning is enabled AND tools are provided, set `toolChoice: { auto: {} }` (not `any`), since forced tool use + thinking may conflict

- [ ] **1.4** (Optional, Phase 2 scope) Pass `toolConfig` into Nova, OpenAI-on-Bedrock, Qwen-on-Bedrock paths
  - These use ConverseStream or Converse; same pattern applies
  - Can be deferred to a follow-up PR

### Phase 2: Parse tool use events from ConverseStream

- [ ] **2.1** Add tool use state tracking to `executeConverseStream()`
  - File: `src/core/api/providers/bedrock.ts`, method `executeConverseStream()`
  - Add a map to track active tool calls by `contentBlockIndex`:
    ```typescript
    const activeToolCalls: Map<number, { toolUseId: string; name: string; inputBuffer: string }> = new Map()
    ```

- [ ] **2.2** Handle `contentBlockStart` with `start.toolUse`
  - In the existing `chunk.contentBlockStart` handler, add a new branch:
    ```typescript
    if (blockStart.start?.toolUse) {
      const { toolUseId, name } = blockStart.start.toolUse
      activeToolCalls.set(blockIndex, { toolUseId, name, inputBuffer: "" })
    }
    ```

- [ ] **2.3** Handle `contentBlockDelta` with `delta.toolUse`
  - In the existing `chunk.contentBlockDelta` handler, add a new branch:
    ```typescript
    if (delta.toolUse?.input !== undefined) {
      const toolCall = activeToolCalls.get(blockIndex)
      if (toolCall) {
        toolCall.inputBuffer += delta.toolUse.input
        yield {
          type: "tool_calls" as const,
          tool_call: {
            call_id: toolCall.toolUseId,
            function: {
              id: toolCall.toolUseId,
              name: toolCall.name,
              arguments: delta.toolUse.input,  // stream partial JSON
            },
          },
        }
      }
    }
    ```
  - Note: We yield on every delta (matching how Anthropic handler yields `input_json_delta`). The downstream `toolUseHandler` in Task accumulates these.

- [ ] **2.4** Handle `contentBlockStop` for tool use blocks
  - Clean up tracking state:
    ```typescript
    if (chunk.contentBlockStop) {
      const blockIndex = chunk.contentBlockStop.contentBlockIndex
      activeToolCalls.delete(blockIndex)
    }
    ```

### Phase 3: Send tool results back to Bedrock

- [ ] **3.1** Update `formatMessagesForConverseAPI()` to handle `tool_use` content blocks
  - File: `src/core/api/providers/bedrock.ts`, method `formatMessagesForConverseAPI()`
  - Currently only handles `text` and `image` types
  - Add mapping for `tool_use` blocks from assistant messages:
    ```typescript
    if (item.type === "tool_use") {
      return {
        toolUse: {
          toolUseId: item.id,
          name: item.name,
          input: item.input,  // JSON object
        },
      }
    }
    ```

- [ ] **3.2** Update `formatMessagesForConverseAPI()` to handle `tool_result` content blocks
  - Add mapping for `tool_result` blocks from user messages:
    ```typescript
    if (item.type === "tool_result") {
      const resultContent = typeof item.content === "string"
        ? [{ text: item.content }]
        : Array.isArray(item.content)
          ? item.content.map(c => c.type === "text" ? { text: c.text } : c).filter(Boolean)
          : [{ text: JSON.stringify(item.content) }]
      return {
        toolResult: {
          toolUseId: item.tool_use_id,
          content: resultContent,
          status: item.is_error ? "error" : "success",
        },
      }
    }
    ```

- [ ] **3.3** Verify that `tool_use` blocks from API conversation history round-trip correctly
  - When Cline stores assistant messages with `tool_use` blocks in `apiConversationHistory`, those get passed back on the next turn
  - Bedrock expects them as `ContentBlock.ToolUseMember` in the `messages` array
  - Ensure the mapping in 3.1 produces the right AWS SDK union shape

### Phase 4: Integration with existing parallel tool calling infrastructure

- [ ] **4.1** Verify `enableNativeToolCalls` / `enableParallelToolCalling` propagation
  - File: `src/core/task/index.ts`, in `attemptApiRequest()` where `promptContext` is built
  - When `enableNativeToolCalls` is true, the system prompt includes native tool definitions, and `getSystemPrompt()` returns `tools`
  - Verify that these `tools` are actually passed through to `this.api.createMessage(systemPrompt, history, tools)`
  - If `tools` are currently only passed for non-Bedrock providers, fix the call site

- [ ] **4.2** Verify that the Bedrock handler's `createMessage()` is called with `tools` from Task
  - File: `src/core/api/index.ts` — the `ApiHandler` interface
  - Check that the interface allows `tools?` as a third parameter
  - Currently `AnthropicHandler.createMessage(systemPrompt, messages, tools?)` accepts it
  - Bedrock handler needs the same signature (done in step 1.1)

- [ ] **4.3** Verify parallel tool execution works end-to-end
  - When `isParallelToolCallingEnabled()` returns true:
    - Task does NOT interrupt the stream after the first tool use
    - ToolExecutor does NOT block execution of a second tool
  - When the Bedrock model emits multiple `toolUse` content blocks, they should all be yielded as `tool_calls` chunks and then executed

### Phase 5: Tests

- [ ] **5.1** Add unit test: tool call parsing from ConverseStream
  - File: `src/core/api/providers/__tests__/bedrock.test.ts`
  - Mock chunks:
    ```typescript
    { contentBlockStart: { start: { toolUse: { toolUseId: "t1", name: "read_file" } }, contentBlockIndex: 1 } },
    { contentBlockDelta: { delta: { toolUse: { input: '{"path":' } }, contentBlockIndex: 1 } },
    { contentBlockDelta: { delta: { toolUse: { input: '"test.ts"}' } }, contentBlockIndex: 1 } },
    { contentBlockStop: { contentBlockIndex: 1 } },
    ```
  - Assert: handler yields `type: "tool_calls"` chunks with correct `function.id`, `name`, `arguments`

- [ ] **5.2** Add unit test: multiple (parallel) tool calls in one response
  - Mock chunks with two tool use blocks (different `contentBlockIndex` values)
  - Assert: both tool calls are yielded

- [ ] **5.3** Add unit test: text + tool use interleaved in one response
  - Mock chunks: text block, then tool use block, then more text
  - Assert: text chunks and tool_calls chunks are yielded in correct order

- [ ] **5.4** Add unit test: `mapClineToolsToBedrockToolConfig()` mapper
  - Input: array of Cline/Anthropic tool definitions
  - Assert: output matches Bedrock `ToolConfiguration` schema

- [ ] **5.5** Add unit test: `formatMessagesForConverseAPI()` with tool_use and tool_result
  - Input: conversation history with tool_use (assistant) and tool_result (user) messages
  - Assert: output messages contain correct Bedrock `toolUse` and `toolResult` content blocks

- [ ] **5.6** Run existing Bedrock tests to ensure no regressions
  - Command: `npm run test:unit -- --grep "AwsBedrockHandler"`

### Phase 6: Verification & Polish

- [ ] **6.1** Manual end-to-end test with Bedrock Claude model
  - Set up Bedrock with `anthropic.claude-sonnet-4-5-20250929-v1:0`
  - Enable parallel tool calling in settings
  - Run a task that triggers multiple tool calls (e.g., "Read these 3 files")
  - Verify tools execute in parallel

- [ ] **6.2** Manual test: single tool call (regression)
  - Verify single tool calls still work correctly

- [ ] **6.3** Manual test: thinking/reasoning + tool calling
  - Enable thinking budget > 0
  - Verify reasoning and tool calls coexist

- [ ] **6.4** Manual test: tool result round-trip
  - Verify that after a tool call, the result is sent back to Bedrock correctly and the model continues

- [ ] **6.5** Update snapshot tests if system prompt changes affect Bedrock
  - Command: `UPDATE_SNAPSHOTS=true npm run test:unit`
  - Only needed if prompt variant configs change

- [ ] **6.6** Consider adding a changeset for user-facing changelog
  - Command: `npm run changeset`
  - Create a patch changeset describing Bedrock parallel tool calling support

---

## Key Files to Modify

| File | Changes |
|------|---------|
| `src/core/api/providers/bedrock.ts` | Main implementation: tool config, stream parsing, message formatting |
| `src/core/api/providers/__tests__/bedrock.test.ts` | Unit tests for tool calling |
| `src/core/api/index.ts` | Possibly: ensure `tools` parameter is threaded to Bedrock handler (verify only) |

## Files to Verify (read-only)

| File | What to check |
|------|---------------|
| `src/core/api/transform/stream.ts` | `ApiStreamToolCallsChunk` interface (should already match) |
| `src/core/task/index.ts` | That `tools` from `getSystemPrompt()` is passed to `this.api.createMessage()` |
| `src/core/task/ToolExecutor.ts` | That parallel tool execution logic is generic (not provider-specific) |
| `src/core/api/providers/anthropic.ts` | Reference implementation for tool call stream parsing |

---

## Risk Assessment

| Risk | Likelihood | Mitigation |
|------|-----------|------------|
| Bedrock `toolUse.input` stream format differs from Anthropic `input_json_delta` | Low | AWS SDK types confirm it's a string; test with real API |
| Tool result format mismatch causes Bedrock API errors | Medium | Careful mapping + integration tests |
| Thinking mode conflicts with tool calling on Bedrock | Low | Set `toolChoice: auto` (not `any`) when thinking is enabled |
| Non-Anthropic Bedrock models (Nova, Qwen) behave differently with tools | Medium | Scope Phase 1 to Anthropic-on-Bedrock only; defer others |
| Existing Bedrock tests break due to signature change | Low | `tools` param is optional; existing calls don't pass it |

---

## Estimated Effort

| Phase | Effort |
|-------|--------|
| Phase 1: Core plumbing | ~2 hours |
| Phase 2: Stream parsing | ~2 hours |
| Phase 3: Tool results | ~2 hours |
| Phase 4: Integration verification | ~1 hour |
| Phase 5: Tests | ~3 hours |
| Phase 6: Manual verification | ~2 hours |
| **Total** | **~12 hours** |

---

## Sequencing

```
Phase 1 (plumbing) → Phase 2 (parsing) → Phase 3 (results) → Phase 4 (integration)
                                                                      ↓
                                                              Phase 5 (tests)
                                                                      ↓
                                                              Phase 6 (verify)
```

Phases 1–3 must be done in order (each builds on the previous).
Phase 4 is a verification pass that may surface issues in 1–3.
Phase 5 can partially overlap with 1–3 (write tests as you go).
Phase 6 requires a working Bedrock account with Claude model access.

---

## Appendix: Programmatic Testing & Verification Strategy

This section describes how Cline can autonomously develop and verify the Bedrock parallel tool calling implementation using programmatic tests — both unit tests with mocks and live integration tests against real Bedrock APIs.

### Overview: Three Testing Layers

| Layer | What it tests | Needs AWS creds? | Speed | File |
|-------|---------------|-------------------|-------|------|
| **1. Unit tests (mock stream)** | Stream parsing, tool config mapping, message formatting | No | Fast (~1s) | `src/core/api/providers/__tests__/bedrock.test.ts` |
| **2. Live integration script** | Real Bedrock API round-trips with tool calling | Yes | Slow (~10-30s) | `scripts/test-bedrock-tool-calling.ts` |
| **3. Existing unit test regression** | Ensure existing behavior isn't broken | No | Fast (~1s) | same `bedrock.test.ts` |

The **live integration script** (Layer 2) is the critical new piece for autonomous development verification. It exercises the full request → stream → parse → tool result round-trip against real Bedrock.

### Layer 1: Unit Tests (Mock Stream) — Already Covered in Phase 5

These are the unit tests described in the existing Phase 5 of the plan. They mock `getBedrockClient()` on the handler instance and inject fake stream chunks. This is the existing pattern used by all other tests in `bedrock.test.ts`.

**Key design points:**
- Mock the client's `send()` method to return a stream of pre-defined chunks
- Assert that the handler's async generator yields the correct `ApiStreamChunk` types
- Tests run with `npm run test:unit -- --grep "AwsBedrockHandler"` — no AWS credentials needed

### Layer 2: Live Integration Test Script

This is the **primary verification mechanism** for autonomous development. It creates a standalone `AwsBedrockHandler` instance with real AWS credentials, sends actual requests to Bedrock with tool definitions, and verifies the responses.

#### Why a standalone script (not mocha)?

1. **Direct execution**: `npx tsx scripts/test-bedrock-tool-calling.ts` — immediate feedback, no test framework overhead
2. **Exit code**: 0 on success, 1 on failure — Cline can check success/failure programmatically
3. **Rich console output**: Detailed logging of every stream chunk for debugging
4. **No VSCode dependency**: `AwsBedrockHandler` can be instantiated directly — it only needs AWS SDK, no extension host
5. **Iterative development**: Run → see failure → fix → re-run, with minimal latency

#### Prerequisites & Credentials

The script needs AWS credentials with Bedrock model access. It should support multiple auth methods:

```typescript
// Auth priority (match what the handler supports):
// 1. Explicit env vars: AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_SESSION_TOKEN
// 2. AWS profile: AWS_PROFILE (uses ~/.aws/credentials)
// 3. Default provider chain (EC2 role, ECS task role, etc.)
```

**Required env vars for the script:**

| Env Var | Required? | Default | Description |
|---------|-----------|---------|-------------|
| `AWS_REGION` | No | `us-east-1` | AWS region with Bedrock Claude access |
| `AWS_ACCESS_KEY_ID` | Yes* | — | AWS access key |
| `AWS_SECRET_ACCESS_KEY` | Yes* | — | AWS secret key |
| `AWS_SESSION_TOKEN` | No | — | Session token (for temp creds) |
| `AWS_PROFILE` | Yes* | — | Alternative: use named profile |
| `BEDROCK_MODEL_ID` | No | `anthropic.claude-sonnet-4-5-20250929-v1:0` | Model to test with |
| `BEDROCK_USE_CROSS_REGION` | No | `false` | Enable cross-region inference (required for Claude 4.5/Opus 4.6 inference profiles) |

\* Either `AWS_ACCESS_KEY_ID`+`AWS_SECRET_ACCESS_KEY` or `AWS_PROFILE` must be set.

**Running the test:**

```bash
# With explicit credentials
AWS_ACCESS_KEY_ID=AKIA... AWS_SECRET_ACCESS_KEY=... npx tsx scripts/test-bedrock-tool-calling.ts

# With named profile
AWS_PROFILE=bedrock-dev npx tsx scripts/test-bedrock-tool-calling.ts

# With custom model/region
AWS_PROFILE=bedrock-dev AWS_REGION=us-west-2 BEDROCK_MODEL_ID=anthropic.claude-3-5-sonnet-20241022-v2:0 npx tsx scripts/test-bedrock-tool-calling.ts

# Claude 4.5/Opus 4.6 models require inference profiles
AWS_PROFILE=bedrock-dev \
BEDROCK_MODEL_ID=anthropic.claude-haiku-4-5-20251001-v1:0 \
BEDROCK_USE_CROSS_REGION=true \
npx tsx scripts/test-bedrock-tool-calling.ts
```

#### Script Structure & Test Cases

The script should be structured as a sequence of named test cases, each returning pass/fail. On any failure, it should print detailed diagnostics (the full stream of chunks received) and exit with code 1.

```
scripts/test-bedrock-tool-calling.ts
├── helper: createTestHandler()           — builds AwsBedrockHandler with env-based config
├── helper: collectStream()               — consumes ApiStream, returns typed chunk arrays
├── helper: makeSimpleToolDefs()          — creates minimal Cline-format tool definitions
├── Test 1: Basic connectivity            — text-only request, no tools
├── Test 2: Single tool call              — request with tools, prompt triggers 1 tool call
├── Test 3: Parallel tool calls           — prompt designed to trigger 2+ simultaneous tool calls
├── Test 4: Tool result round-trip        — multi-turn: tool call → tool result → continuation
├── Test 5: Text + tool interleaving      — verify text and tool_calls chunks coexist correctly
└── Test 6: Thinking + tool calling       — reasoning enabled + tool definitions
```

#### Test Case Details

**Test 1: Basic connectivity (smoke test)**
- Purpose: Verify credentials work and the handler streams text correctly (regression baseline)
- Request: `systemPrompt="You are a helpful assistant."`, `messages=[{role:"user", content:"Say hello in exactly 3 words."}]`, no tools
- Assert: At least one `type: "text"` chunk is yielded, and at least one `type: "usage"` chunk
- Why: If this fails, the problem is auth/connectivity, not tool calling

**Test 2: Single tool call**
- Purpose: Verify the handler parses a single `toolUse` content block from the stream
- Tool definitions: Provide a minimal `read_file` tool:
  ```typescript
  [{
    name: "read_file",
    description: "Read the contents of a file at the specified path.",
    input_schema: {
      type: "object",
      properties: { path: { type: "string", description: "File path to read" } },
      required: ["path"]
    }
  }]
  ```
- System prompt: `"You are a helpful assistant. You MUST use the read_file tool to answer questions about files. Do not respond with text — only use tools."`
- User message: `"What is in the file /tmp/test.txt?"`
- Assert:
  - At least one chunk with `type: "tool_calls"` is yielded
  - The tool call has `function.name === "read_file"`
  - The tool call has `function.id` set (non-empty `toolUseId`)
  - The accumulated `function.arguments` across all deltas for this tool is valid JSON containing `{"path": "/tmp/test.txt"}` (or similar)
- Implementation note: The arguments arrive as partial JSON strings across multiple `tool_calls` chunks (like Anthropic's `input_json_delta`). The test should accumulate them and parse the final result.

**Test 3: Parallel tool calls**
- Purpose: Verify the handler emits multiple distinct tool calls from a single response
- Tool definitions: Same `read_file` tool as Test 2
- System prompt: Same as Test 2 (force tool use)
- User message: `"Read these three files: /tmp/a.txt, /tmp/b.txt, and /tmp/c.txt"`
- Assert:
  - Multiple distinct `tool_calls` chunks are yielded
  - Group by `function.id` — expect at least 2 distinct tool call IDs (ideally 3)
  - Each has `function.name === "read_file"`
  - Each has different arguments (different file paths)
- Note: The model may or may not produce exactly 3 parallel calls — it depends on the model's behavior. The assertion should be **at least 2 distinct tool call IDs**, which proves parallel calling works. If only 1 is produced, that's a potential issue but could be model behavior — log a warning rather than hard fail.

**Test 4: Tool result round-trip**
- Purpose: Verify that `formatMessagesForConverseAPI()` correctly formats `tool_use` (assistant) and `tool_result` (user) blocks, and that Bedrock accepts them and continues
- Setup:
  1. Run Test 2 to get a real tool call response
  2. Build a conversation history with:
     - `[0]` user: `"What is in /tmp/test.txt?"`
     - `[1]` assistant: `[{ type: "tool_use", id: "<from_test_2>", name: "read_file", input: { path: "/tmp/test.txt" } }]`
     - `[2]` user: `[{ type: "tool_result", tool_use_id: "<from_test_2>", content: "Hello, this is the file content." }]`
  3. Send this conversation to `createMessage()` with the same tool definitions
- Assert:
  - The request does NOT throw an API error (Bedrock accepted the tool_use/tool_result format)
  - The response yields at least one `type: "text"` chunk (the model continues based on the tool result)
  - OR the response yields another `type: "tool_calls"` chunk (model wants to call another tool)
- Why this is critical: This is the most likely failure point — if `formatMessagesForConverseAPI()` doesn't produce the correct Bedrock `toolUse`/`toolResult` content block shapes, Bedrock returns a validation error. This test catches that directly.

**Test 5: Text + tool interleaving**
- Purpose: Verify text and tool_calls chunks coexist in a single response
- Tool definitions: `read_file` tool
- System prompt: `"You are a helpful assistant. When asked about files, first briefly explain what you're going to do, then use the read_file tool."`
- User message: `"Can you check what's in /tmp/test.txt?"`
- Assert:
  - At least one `type: "text"` chunk is yielded (the explanation)
  - At least one `type: "tool_calls"` chunk is yielded (the tool call)
  - The text chunk(s) appear before the first tool_calls chunk (verify ordering)
- Note: This test is somewhat non-deterministic — the model might skip the explanation. If it does, log a warning but don't fail. The primary assertion is that both types CAN coexist in the output.

**Test 6: Thinking + tool calling (if applicable)**
- Purpose: Verify reasoning/thinking + tool calling coexist when thinking budget is set
- Only runs if the model supports reasoning (e.g., Claude Sonnet 4.5)
- Handler options: `thinkingBudgetTokens: 2048`
- Same tool definitions and prompt as Test 2
- Assert:
  - At least one `type: "reasoning"` chunk is yielded
  - At least one `type: "tool_calls"` chunk is yielded
  - No API errors thrown
- Note: This tests the `toolChoice: { auto: {} }` logic (thinking + tool use require `auto`, not `any`)

#### Detailed Script Implementation Guidance

Here's the recommended structure for Cline to implement:

```typescript
// scripts/test-bedrock-tool-calling.ts
import { AwsBedrockHandler, AwsBedrockHandlerOptions } from "../src/core/api/providers/bedrock"
import type { ApiStreamChunk } from "../src/core/api/transform/stream"

// ─── Configuration ────────────────────────────────────────────
const REGION = process.env.AWS_REGION || "us-east-1"
const MODEL_ID = process.env.BEDROCK_MODEL_ID || "anthropic.claude-sonnet-4-5-20250929-v1:0"
const USE_CROSS_REGION = process.env.BEDROCK_USE_CROSS_REGION === "true"

// ─── Helpers ──────────────────────────────────────────────────

function createTestHandler(opts?: Partial<AwsBedrockHandlerOptions>): AwsBedrockHandler {
  return new AwsBedrockHandler({
    apiModelId: MODEL_ID,
    awsRegion: REGION,
    awsAccessKey: process.env.AWS_ACCESS_KEY_ID || "",
    awsSecretKey: process.env.AWS_SECRET_ACCESS_KEY || "",
    awsSessionToken: process.env.AWS_SESSION_TOKEN || "",
    awsUseProfile: !!process.env.AWS_PROFILE,
    awsProfile: process.env.AWS_PROFILE || "",
    awsUseCrossRegionInference: USE_CROSS_REGION,
    awsBedrockUsePromptCache: false,
    thinkingBudgetTokens: 0,
    ...opts,
  })
}

// Collect all chunks from an ApiStream into a typed array
async function collectStream(
  stream: AsyncGenerator<ApiStreamChunk>
): Promise<{ chunks: ApiStreamChunk[]; error?: Error }> {
  const chunks: ApiStreamChunk[] = []
  try {
    for await (const chunk of stream) {
      chunks.push(chunk)
    }
    return { chunks }
  } catch (error) {
    return { chunks, error: error as Error }
  }
}

// Build minimal Cline-format tool definitions (Anthropic format)
function makeReadFileTool() {
  return {
    name: "read_file",
    description: "Read the contents of a file at the specified path.",
    input_schema: {
      type: "object" as const,
      properties: {
        path: { type: "string", description: "The path of the file to read" }
      },
      required: ["path"],
    },
  }
}

// Group tool_calls chunks by tool call ID, accumulating arguments
function groupToolCalls(chunks: ApiStreamChunk[]): Map<string, { name: string; args: string }> {
  const calls = new Map<string, { name: string; args: string }>()
  for (const chunk of chunks) {
    if (chunk.type === "tool_calls") {
      const id = chunk.tool_call.function.id || chunk.tool_call.call_id || "unknown"
      const existing = calls.get(id) || { name: "", args: "" }
      if (chunk.tool_call.function.name) existing.name = chunk.tool_call.function.name
      existing.args += chunk.tool_call.function.arguments || ""
      calls.set(id, existing)
    }
  }
  return calls
}

// ─── Test runner ──────────────────────────────────────────────

interface TestResult { name: string; passed: boolean; detail: string; duration: number }

async function runTest(name: string, fn: () => Promise<void>): Promise<TestResult> {
  const start = Date.now()
  try {
    await fn()
    const duration = Date.now() - start
    console.log(`  ✅ ${name} (${duration}ms)`)
    return { name, passed: true, detail: "OK", duration }
  } catch (err) {
    const duration = Date.now() - start
    const detail = err instanceof Error ? err.message : String(err)
    console.error(`  ❌ ${name} (${duration}ms): ${detail}`)
    return { name, passed: false, detail, duration }
  }
}

// Each test function should throw on assertion failure.
// Use simple assert-style checks rather than importing a framework.
function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(`Assertion failed: ${message}`)
}

// ─── Main ─────────────────────────────────────────────────────
async function main() {
  // ... validate credentials are available ...
  // ... run tests sequentially ...
  // ... print summary, exit 0 or 1 ...
}
```

#### How to Handle Non-Deterministic Model Behavior

LLM outputs are non-deterministic. The test script should handle this gracefully:

1. **Retry logic**: Each test can be retried up to 2 times on failure (model might not cooperate on first try)
2. **Soft assertions**: For tests where model behavior varies (Test 3: parallel calls, Test 5: interleaving), use "warn" vs "fail" thresholds:
   - Hard fail: No `tool_calls` chunks at all (implementation bug)
   - Soft warn: Only 1 tool call when 3 were expected (model behavior, not necessarily a bug)
3. **Strong prompting**: Use system prompts that maximize tool use likelihood:
   - `"You MUST use tools. Do not respond with text explanations."`
   - `"Always use the read_file tool when asked about files. Never guess file contents."`
4. **Temperature 0**: Already enforced by the handler for non-thinking mode
5. **Diagnostic output**: On failure, print ALL chunks received so Cline can diagnose the issue

#### Conversation History Format for Tool Result Round-Trip (Test 4)

This is the trickiest part. The `createMessage()` method receives `ClineStorageMessage[]` which use Anthropic's content format. For the tool result round-trip, the messages need to look like:

```typescript
const messages: ClineStorageMessage[] = [
  // Turn 1: User asks to read a file
  {
    role: "user",
    content: [{ type: "text", text: "What is in the file /tmp/test.txt?" }],
    ts: Date.now(),
  },
  // Turn 2: Assistant responds with tool_use
  {
    role: "assistant",
    content: [{
      type: "tool_use",
      id: toolCallId,    // from Test 2 result
      name: "read_file",
      input: { path: "/tmp/test.txt" },
    }],
    ts: Date.now(),
  },
  // Turn 3: User provides tool_result
  {
    role: "user",
    content: [{
      type: "tool_result",
      tool_use_id: toolCallId,  // must match the tool_use id
      content: "Hello, this is the file content.",
    }],
    ts: Date.now(),
  },
]
```

The test verifies that `formatMessagesForConverseAPI()` correctly maps:
- `tool_use` → Bedrock's `ContentBlock.ToolUseMember` shape
- `tool_result` → Bedrock's `ContentBlock.ToolResultMember` shape

If the format is wrong, Bedrock will return a `ValidationException` — the test catches this directly.

#### Development Loop: How Cline Should Use This Script

The recommended iterative workflow for autonomous development:

```
1. Implement Phase 1 (tool config plumbing)
   ↓
2. Run: npx tsx scripts/test-bedrock-tool-calling.ts
   → Test 1 (smoke) should pass
   → Test 2 (single tool call) should FAIL (stream parsing not implemented yet)
   → Tests 3-6 should FAIL
   ↓
3. Implement Phase 2 (stream parsing)
   ↓
4. Run: npx tsx scripts/test-bedrock-tool-calling.ts
   → Tests 1-2 should pass
   → Test 3 (parallel) should pass (or warn)
   → Test 4 (round-trip) should FAIL (message formatting not implemented yet)
   → Test 5-6 should pass or warn
   ↓
5. Implement Phase 3 (tool results)
   ↓
6. Run: npx tsx scripts/test-bedrock-tool-calling.ts
   → All tests should pass
   ↓
7. Run: npm run test:unit -- --grep "AwsBedrockHandler"
   → All unit tests (mock-based) should pass
   ↓
8. Done — all layers green
```

Each run provides immediate, concrete feedback on what works and what doesn't. The script's exit code (0/1) makes it easy for Cline to determine success/failure without parsing output.

#### Error Scenarios the Script Should Detect

| Error | Symptom | Likely Cause |
|-------|---------|-------------|
| `ValidationException: Malformed input` | Test 4 fails with API error | `formatMessagesForConverseAPI()` produces wrong shape for `toolUse`/`toolResult` |
| No `tool_calls` chunks in output | Tests 2-3 fail, only `text` chunks received | `toolConfig` not being passed to `ConverseStreamCommand`, or stream parsing not yielding `tool_calls` |
| `tool_calls` chunk has empty `function.id` | Tests 2-3 assertions fail | `contentBlockStart.start.toolUse.toolUseId` not being captured |
| `tool_calls` chunk has empty `function.arguments` | Tests 2-3 assertions fail | `contentBlockDelta.delta.toolUse.input` not being read |
| `ThrottlingException` | Any test fails intermittently | Rate limiting — add retry with backoff |
| `AccessDeniedException` | All tests fail at first request | AWS credentials lack Bedrock `InvokeModelWithResponseStream` permission |
| Thinking + tool calling conflict | Test 6 fails | `toolChoice` set to `any` instead of `auto` when thinking is enabled |

#### File Placement

| File | Purpose |
|------|---------|
| `scripts/test-bedrock-tool-calling.ts` | Standalone live integration test script (primary verification) |
| `src/core/api/providers/__tests__/bedrock.test.ts` | Existing file — add new `describe` blocks for tool calling unit tests (Phase 5) |

The standalone script is intentionally NOT in `src/**/__tests__/` so it doesn't run with `npm run test:unit` (which would fail without AWS credentials in CI). It's a developer/Cline tool for local verification only.

#### Summary: What This Gives Cline for Autonomous Development

1. **Fast feedback loop**: Run one command, get pass/fail on the full feature
2. **Layered confidence**: Mock tests verify parsing logic; live tests verify API compatibility
3. **Targeted diagnostics**: Each test case isolates a specific piece (plumbing, parsing, formatting, round-trip)
4. **Progressive verification**: Tests are designed to pass incrementally as phases are completed
5. **No VSCode dependency**: Both the handler and the test script run standalone
6. **No manual intervention**: No UI, no browser, no interactive steps — pure programmatic verification
