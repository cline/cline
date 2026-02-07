# Cline Actions & Thinking Log: Internals Guide

This document describes how Cline's **thinking** (AI reasoning/chain-of-thought) and **actions** (tool calls like editing files, executing commands, searching) flow through the system. It provides code references and explains how to intercept both.

---

## Table of Contents

1. [Thinking (Reasoning) Flow](#1-thinking-reasoning-flow)
2. [Actions (Tool Execution) Flow](#2-actions-tool-execution-flow)
3. [Intercepting Thinking](#3-intercepting-thinking)
4. [Intercepting Actions](#4-intercepting-actions)
5. [Hooks System Overview](#5-hooks-system-overview)
6. [Key Data Types Reference](#6-key-data-types-reference)

---

## 1. Thinking (Reasoning) Flow

Cline supports extended thinking / chain-of-thought from models that provide it (Claude with extended thinking, OpenAI reasoning models, DeepSeek R1, etc.). Here is how thinking content flows from the API provider to the UI.

### 1.1 API Layer: Streaming Reasoning Chunks

Each API provider emits an `ApiStreamThinkingChunk` when reasoning content arrives:

**Chunk type definition** - `src/core/api/transform/stream.ts:72-98`
```typescript
export interface ApiStreamThinkingChunk {
    type: "reasoning"
    reasoning: string       // The reasoning text (or "[REDACTED]" for redacted blocks)
    details?: unknown       // Provider-specific reasoning details (OpenRouter, OpenAI summaries)
    signature?: string      // Signature for sending thinking back to API (Anthropic, Gemini)
    redacted_data?: string  // Redacted thinking data
    id?: string             // Response ID
}
```

**Provider example (Anthropic)** - `src/core/api/providers/anthropic.ts:151-202`

The Anthropic provider yields reasoning chunks for three event types:
- `content_block_start` with `type: "thinking"` - beginning of a thinking block
- `content_block_delta` with `type: "thinking_delta"` - incremental thinking text
- `content_block_delta` with `type: "signature_delta"` - signature for preserving thinking traces

### 1.2 Stream Response Handler: Accumulating Reasoning

The `StreamResponseHandler` in `src/core/task/StreamResponseHandler.ts` manages a `ReasoningHandler` that accumulates reasoning deltas into a complete thinking block.

**ReasoningHandler** - `src/core/task/StreamResponseHandler.ts:273-351`
- `processReasoningDelta(delta)` - Accumulates reasoning text, signatures, details, and redacted data
- `getCurrentReasoning()` - Returns the current `ClineAssistantThinkingBlock` (type: "thinking")
- `getRedactedThinking()` - Returns redacted thinking blocks for conversation history

**PendingReasoning structure** - `src/core/task/StreamResponseHandler.ts:41-47`
```typescript
export interface PendingReasoning {
    id?: string
    content: string                              // Accumulated reasoning text
    signature: string                            // Signature for API round-trips
    redactedThinking: ClineAssistantRedactedThinkingBlock[]
    summary: unknown[] | ClineReasoningDetailParam[]  // OpenAI reasoning details
}
```

### 1.3 Task Main Loop: Processing Reasoning in the Stream

In the main streaming loop at `src/core/task/index.ts:2604-2686`, reasoning chunks are handled in the `case "reasoning"` branch (line 2615):

1. The reasoning delta is passed to `reasonsHandler.processReasoningDelta()` (line 2619)
2. If the task is not aborted and there is thinking content, it is sent to the UI via `this.say("reasoning", thinkingBlock.thinking, ..., true)` (line 2631) - `partial=true` for streaming
3. When text content starts arriving (line 2659), the reasoning is finalized with `this.say("reasoning", currentReasoning.thinking, ..., false)` (line 2664) - `partial=false`

### 1.4 Message Storage & Webview Display

The `say("reasoning", ...)` call creates a `ClineMessage` with `say: "reasoning"` type:

**ClineSay type** - `src/shared/ExtensionMessage.ts:158-193`
- `"reasoning"` is one of the `ClineSay` union members (line 165)

**Webview rendering** - The reasoning messages are found and collected by:
- `findReasoningForApiReq()` in `webview-ui/src/components/chat/chat-view/utils/messageUtils.ts:208-238` - Scans messages after an `api_req_started` to collect reasoning parts
- `MessageRenderer.tsx:48-54` - Passes reasoning data to the chat row
- `ThinkingRow.tsx` (`webview-ui/src/components/chat/ThinkingRow.tsx`) - Renders the "Thoughts" collapsible section

### 1.5 Conversation History Preservation

After the stream completes, thinking blocks are preserved in API conversation history (`src/core/task/index.ts:2835-2888`):
- Redacted thinking blocks are added first (line 2840)
- The current thinking block (with signature) is added (line 2844-2845)
- Reasoning details/summaries are attached to text blocks or tool use blocks for providers that need them (lines 2854-2865)

---

## 2. Actions (Tool Execution) Flow

Actions are tool calls that Cline makes: reading files, writing files, executing commands, searching, browsing, MCP tool use, etc.

### 2.1 Tool Call Parsing

Tool calls arrive via two mechanisms:

**XML-based tools** (traditional) - Parsed from assistant text via `parseAssistantMessageV2()`:
- `src/core/assistant-message/index.ts:3` - Exports `parseAssistantMessageV2`
- Extracts XML tool tags like `<read_file>`, `<write_to_file>`, etc. from the streamed text
- Returns `AssistantMessageContent[]` which includes `ToolUse` blocks

**Native tool calls** (for models using function calling) - Handled by `ToolUseHandler`:
- `src/core/task/StreamResponseHandler.ts:92-268` - Processes `tool_calls` chunks
- Accumulates tool name, input JSON, signatures via `processToolUseDelta()`
- Converts to `ClineAssistantToolUseBlock` format via `getFinalizedToolUse()`

**ToolUse type** - `src/core/assistant-message/index.ts:56-74`
```typescript
export interface ToolUse {
    type: "tool_use"
    name: ClineDefaultTool   // Tool identifier (e.g., "read_file", "write_to_file")
    params: Partial<Record<ToolParamName, string>>  // Tool parameters
    partial: boolean          // Whether still streaming
    isNativeToolCall?: boolean
    call_id?: string
    signature?: string
}
```

### 2.2 Tool Presentation and Execution

In `presentAssistantMessage()` at `src/core/task/index.ts:2051-2191`:

1. **Text blocks** (line 2078): Cleaned of `<thinking>`, `<think>`, `<function_calls>` tags, then sent via `say("text", ...)`
2. **Tool use blocks** (line 2143): Delegated to `toolExecutor.executeTool(block)` (line 2152)

### 2.3 ToolExecutor: The Orchestrator

`src/core/task/ToolExecutor.ts` is the central coordinator for all tool execution.

**Entry point** - `ToolExecutor.executeTool()` (line 245) delegates to `execute()` (line 341)

**Execution flow** (line 341-405):
1. Check if tool is registered with the coordinator
2. Check if user rejected a previous tool
3. Check plan mode restrictions (file modification tools blocked in plan mode)
4. Close browser for non-browser tools
5. **Partial blocks** -> `handlePartialBlock()` (line 546) - UI streaming updates only
6. **Complete blocks** -> `handleCompleteBlock()` (line 578) - Full execution with hooks

### 2.4 Tool Handler Registration

All 23+ tool handlers are registered in `ToolExecutor.registerToolHandlers()` (line 207-240):

```
ReadFileToolHandler, WriteToFileToolHandler, ExecuteCommandToolHandler,
SearchFilesToolHandler, BrowserToolHandler, ListFilesToolHandler,
WebFetchToolHandler, WebSearchToolHandler, UseMcpToolHandler,
ApplyPatchHandler, AttemptCompletionHandler, GenerateExplanationToolHandler, ...
```

**Handler interface** - `src/core/task/tools/ToolExecutorCoordinator.ts:8-12`
```typescript
export interface IToolHandler {
    readonly name: ClineDefaultTool
    execute(config: TaskConfig, block: ToolUse): Promise<ToolResponse>
    getDescription(block: ToolUse): string
}
```

### 2.5 Complete Block Execution Flow

`handleCompleteBlock()` at `src/core/task/ToolExecutor.ts:578-654`:

1. **Execute tool** via `coordinator.execute(config, block)` (line 601)
2. **Push result** to conversation via `pushToolResult()` (line 603)
3. **Run PostToolUse hook** if enabled (line 616)
4. **Update focus chain** if enabled (line 651)

### 2.6 Individual Tool Handler Pattern

Each handler follows a similar pattern (example: `ReadFileToolHandler`):

**File**: `src/core/task/tools/handlers/ReadFileToolHandler.ts`

1. `handlePartialBlock()` (line 27): Shows streaming UI with file path as it's being typed
2. `execute()` (line 52): Validates params -> checks clineignore -> resolves path -> handles approval (auto or manual) -> runs **PreToolUse hook** -> reads file -> returns content

---

## 3. Intercepting Thinking

### 3.1 At the API Stream Level

The most fundamental interception point is in the main streaming loop.

**Location**: `src/core/task/index.ts:2615-2635`

```typescript
case "reasoning": {
    reasonsHandler.processReasoningDelta({
        id: chunk.id,
        reasoning: chunk.reasoning,  // <-- Raw reasoning text chunk
        signature: chunk.signature,
        details,
        redacted_data: chunk.redacted_data,
    })
    // The thinking block is sent to UI here:
    const thinkingBlock = reasonsHandler.getCurrentReasoning()
    if (thinkingBlock?.thinking && chunk.reasoning) {
        await this.say("reasoning", thinkingBlock.thinking, undefined, undefined, true)
    }
    break
}
```

**How to intercept**: Add logic inside this `case "reasoning"` block to capture/log each reasoning delta as it arrives. The `chunk.reasoning` string contains the incremental thinking text. The accumulated thinking is available via `reasonsHandler.getCurrentReasoning()?.thinking`.

### 3.2 At the `say()` Message Level

Every time thinking content is sent to the UI, it goes through the `say()` method.

**Location**: `src/core/task/index.ts:717-776`

The `say()` method creates `ClineMessage` objects with `type: "say"` and `say: "reasoning"`. You can intercept here by:
- Adding a filter/callback when `type === "reasoning"`
- Inspecting the `text` parameter which contains the full accumulated reasoning

### 3.3 At the StreamResponseHandler Level

**Location**: `src/core/task/StreamResponseHandler.ts:276` (`processReasoningDelta`)

The `ReasoningHandler.processReasoningDelta()` method is where each individual reasoning delta is accumulated. You can intercept here to capture reasoning as it builds up incrementally.

### 3.4 At the Webview/UI Level

**Location**: `webview-ui/src/components/chat/chat-view/utils/messageUtils.ts:208-238`

The `findReasoningForApiReq()` function collects all `say: "reasoning"` messages between API requests. This is where the webview aggregates thinking content for display. You can intercept here to modify how thinking is presented.

### 3.5 At the Conversation History Level

**Location**: `src/core/task/index.ts:2842-2846`

After the stream completes, thinking blocks are added to `assistantContent` for the API conversation history. This is where you can intercept to modify what thinking gets stored and sent back in future API calls.

---

## 4. Intercepting Actions

### 4.1 Using the Hooks System (Recommended)

Cline provides a **built-in hooks system** for intercepting actions without modifying core code.

**PreToolUse Hook** - Runs AFTER user approval but BEFORE tool execution:
- **Location of hook execution**: `src/core/task/tools/utils/ToolHookUtils.ts:21-113`
- **Input data**: Tool name, parameters (path, command, content, diff, url, etc.)
- **Can cancel**: Yes - return `{ cancel: true }` to abort the tool and task
- **Can inject context**: Yes - return `{ contextModification: "..." }` to add context

**PostToolUse Hook** - Runs AFTER tool execution completes:
- **Location of hook execution**: `src/core/task/ToolExecutor.ts:488-532`
- **Input data**: Tool name, parameters, result, success status, execution time
- **Can cancel**: Yes - return `{ cancel: true }` to abort the task
- **Can inject context**: Yes - return `{ contextModification: "..." }`

**Hook script setup**:
Place executable scripts in these directories:
- Global: `~/Documents/Cline/Hooks/PreToolUse` or `~/Documents/Cline/Hooks/PostToolUse`
- Workspace: `.clinerules/hooks/PreToolUse` or `.clinerules/hooks/PostToolUse`

Hook scripts receive JSON via stdin and must output JSON to stdout:
```json
// Input (PreToolUse example):
{
    "hookName": "PreToolUse",
    "taskId": "abc123",
    "clineVersion": "3.x.x",
    "preToolUse": {
        "toolName": "read_file",
        "parameters": { "path": "src/main.ts" }
    }
}

// Output:
{
    "cancel": false,
    "contextModification": "Optional context to inject into conversation",
    "errorMessage": ""
}
```

**Hook factory** - `src/core/hooks/hook-factory.ts:100-125` - Defines all hook types:
```
PreToolUse, PostToolUse, UserPromptSubmit, TaskStart,
TaskResume, TaskCancel, TaskComplete, PreCompact
```

### 4.2 At the ToolExecutor Level

**Location**: `src/core/task/ToolExecutor.ts:341` (`execute()` method)

This is the central dispatch point for all tool execution. Every tool call passes through here. You can intercept by:
- Adding logging before `coordinator.execute(config, block)` (line 601)
- Inspecting `block.name` and `block.params` for the tool being called
- Capturing `toolResult` after execution

### 4.3 At the ToolExecutorCoordinator Level

**Location**: `src/core/task/tools/ToolExecutorCoordinator.ts:80`

The `execute()` method dispatches to the registered handler. You can intercept here to add cross-cutting concerns (logging, auditing) for all tools.

### 4.4 At the Individual Handler Level

Each handler in `src/core/task/tools/handlers/` has:
- `handlePartialBlock()` - Intercept streaming UI updates
- `execute()` - Intercept the actual tool operation

Key handlers to intercept:
| Handler | File | What it does |
|---------|------|-------------|
| `ReadFileToolHandler` | `handlers/ReadFileToolHandler.ts` | Reads file contents |
| `WriteToFileToolHandler` | `handlers/WriteToFileToolHandler.ts` | Creates/edits files |
| `ExecuteCommandToolHandler` | `handlers/ExecuteCommandToolHandler.ts` | Runs shell commands |
| `SearchFilesToolHandler` | `handlers/SearchFilesToolHandler.ts` | Regex search across files |
| `BrowserToolHandler` | `handlers/BrowserToolHandler.ts` | Browser automation |
| `ApplyPatchHandler` | `handlers/ApplyPatchHandler.ts` | Applies unified diffs |
| `UseMcpToolHandler` | `handlers/UseMcpToolHandler.ts` | MCP tool execution |

### 4.5 At the `say()` / `ask()` Message Level

All tool UI messages flow through `say()` and `ask()` in the Task class:

- `say("tool", ...)` - Sends tool info to webview (auto-approved tools)
- `ask("tool", ...)` - Prompts user for approval
- `say("command", ...)` - Shows command execution info
- `ask("command", ...)` - Prompts for command approval

**Location**: `src/core/task/index.ts:717` (say), and the corresponding `ask()` method

### 4.6 At the TaskState Level

**Location**: `src/core/task/TaskState.ts:6-46`

The `TaskState` object tracks execution state including:
- `assistantMessageContent` - Parsed assistant message blocks (text + tool_use)
- `userMessageContent` - Tool results being accumulated for next API call
- `didRejectTool` / `didAlreadyUseTool` - Execution flags
- `lastToolName` - Last executed tool name

---

## 5. Hooks System Overview

The hooks system is the recommended way to intercept actions. Here is how it works internally.

### 5.1 Architecture

```
Hook Script (executable file)
    |
    v
HookFactory (src/core/hooks/hook-factory.ts)
  - Discovers scripts in global + workspace dirs
  - Creates StdioHookRunner or CombinedHookRunner
    |
    v
StdioHookRunner
  - Spawns child process
  - Sends HookInput as JSON via stdin
  - Streams stdout/stderr line-by-line
  - Parses JSON output (HookOutput)
    |
    v
executeHook() (src/core/hooks/hook-executor.ts:56)
  - Orchestrates: create runner -> show status -> execute -> handle result
  - Updates UI with hook_status and hook_output_stream messages
```

### 5.2 Hook Lifecycle Events

| Hook | When | Can Cancel? | Reference |
|------|------|-------------|-----------|
| `TaskStart` | When a new task begins | No | `hook-factory.ts:110` |
| `TaskResume` | When a task is resumed | No | `hook-factory.ts:113` |
| `UserPromptSubmit` | When user sends a message | Yes | `hook-factory.ts:107` |
| `PreToolUse` | After approval, before execution | Yes | `hook-factory.ts:101` |
| `PostToolUse` | After tool execution | Yes | `hook-factory.ts:104` |
| `PreCompact` | Before conversation compaction | No | `hook-factory.ts:122` |
| `TaskCancel` | When task is cancelled | No | `hook-factory.ts:116` |
| `TaskComplete` | When task finishes | No | `hook-factory.ts:119` |

### 5.3 Hook Input/Output Protocol

**Input** (JSON via stdin) - defined in `src/shared/proto/cline/hooks.ts`:
```
HookInput {
    clineVersion, hookName, taskId, timestamp, workspaceRoots, userId,
    preToolUse?: { toolName, parameters },
    postToolUse?: { toolName, parameters, result, success, executionTimeMs },
    userPromptSubmit?: { prompt },
    taskStart?: { ... },
    ...
}
```

**Output** (JSON via stdout):
```
HookOutput {
    cancel: boolean,           // true to abort the task
    contextModification: string, // extra context injected into conversation
    errorMessage: string        // error message to display
}
```

### 5.4 Multiple Hooks & Parallel Execution

When both global and workspace hooks exist for the same event, they run in parallel via `CombinedHookRunner` (`src/core/hooks/hook-factory.ts:634-667`):
- If ANY hook returns `cancel: true`, the task is cancelled
- All `contextModification` strings are concatenated
- All `errorMessage` strings are concatenated

---

## 6. Key Data Types Reference

### Message Types

| Type | File | Purpose |
|------|------|---------|
| `ClineSay` | `src/shared/ExtensionMessage.ts:158` | All possible "say" message types |
| `ClineAsk` | `src/shared/ExtensionMessage.ts:139` | All possible "ask" message types |
| `ClineMessage` | `src/shared/ExtensionMessage.ts:107` | Full message structure with ts, type, say/ask, text |

### Content Block Types

| Type | File | Purpose |
|------|------|---------|
| `AssistantMessageContent` | `src/core/assistant-message/index.ts:3` | Union: TextStreamContent, ToolUse, ReasoningStreamContent |
| `ToolUse` | `src/core/assistant-message/index.ts:56` | Parsed tool call with name, params, partial flag |
| `ReasoningStreamContent` | `src/core/assistant-message/index.ts:76` | Reasoning text with signature and details |
| `ClineAssistantThinkingBlock` | `src/shared/messages/content.ts:51` | Thinking block for API conversation history |

### API Stream Types

| Type | File | Purpose |
|------|------|---------|
| `ApiStreamThinkingChunk` | `src/core/api/transform/stream.ts:72` | Reasoning chunk from API |
| `ApiStreamTextChunk` | `src/core/api/transform/stream.ts:4` | Text chunk from API |
| `ApiStreamToolCallsChunk` | `src/core/api/transform/stream.ts:34` | Tool call chunk from API |

### Tool Execution Types

| Type | File | Purpose |
|------|------|---------|
| `ClineDefaultTool` | `src/shared/tools.ts` | Enum of all tool names |
| `IToolHandler` | `src/core/task/tools/ToolExecutorCoordinator.ts:8` | Tool handler interface |
| `TaskConfig` | `src/core/task/tools/types/TaskConfig.ts` | Config passed to all handlers |
| `TaskState` | `src/core/task/TaskState.ts:6` | Mutable state during task execution |

---

## Summary

| What | Where to intercept | How |
|------|-------------------|-----|
| **Thinking (streaming)** | `src/core/task/index.ts:2615` | Add logic in `case "reasoning"` |
| **Thinking (accumulated)** | `StreamResponseHandler.ts:276` | Hook into `processReasoningDelta()` |
| **Thinking (UI messages)** | `src/core/task/index.ts:717` | Filter `say("reasoning", ...)` |
| **Actions (before execution)** | Hooks: `.clinerules/hooks/PreToolUse` | Create hook script |
| **Actions (after execution)** | Hooks: `.clinerules/hooks/PostToolUse` | Create hook script |
| **Actions (at dispatch)** | `src/core/task/ToolExecutor.ts:341` | Modify `execute()` method |
| **Actions (per handler)** | `src/core/task/tools/handlers/*.ts` | Modify individual handler |
| **All messages (UI)** | `src/core/task/index.ts:717` | Intercept `say()` method |
