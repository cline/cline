# CLINE TOOL MECHANICS: CODE INVENTORY v1

**Date**: 2026-01-28
**Mode**: READ-ONLY (no code changes, no commits)
**Target**: Map tool execution pipeline for CCA/Flowstate adaptation

---

## 1. INVENTORY SUMMARY

Cline uses a **modular, coordinator-based tool execution architecture** with:
- **24 tools** exposed to the LLM via system prompt specifications
- **Model-variant support**: Different tool definitions per ModelFamily (GENERIC, GPT-5, Gemini, XS, etc.)
- **Two-tier approval**: Auto-approval (configurable per action) + manual modal approval
- **Streaming architecture**: Partial blocks update UI; complete blocks execute and push results
- **Safety enforcement**: Path allowlists (`.clineignore`), command permission env var, file size limits (20MB), approval gates
- **Hook system**: Pre/post-tool execution custom logic with cancellation support

---

## 2. TOOL SURFACE TABLE

| Tool ID | Formal Name | Args (Examples) | Returns | Definition Location | Handler Location |
|---------|------------|-----------------|---------|-------------------|-----------------|
| `FILE_READ` | `read_file` | `path` (file path) | File contents (text or image block) | `src/core/prompts/system-prompt/tools/read_file.ts` | `src/core/task/tools/handlers/ReadFileToolHandler.ts:18–178` |
| `FILE_NEW` | `write_to_file` | `path`, `content` | Confirmation or error | `src/core/prompts/system-prompt/tools/write_to_file.ts` | `src/core/task/tools/handlers/WriteToFileToolHandler.ts` |
| `FILE_EDIT` | `replace_in_file` | `path`, `old_str`, `new_str` | Confirmation or error | `src/core/prompts/system-prompt/tools/write_to_file.ts` | `src/core/task/tools/handlers/WriteToFileToolHandler.ts` |
| `SEARCH` | `search_files` | `regex`, `file_pattern`, `recursive` | Ripgrep results (file:line:match) | `src/core/prompts/system-prompt/tools/search_files.ts` | `src/core/task/tools/handlers/SearchFilesToolHandler.ts:21–276` |
| `LIST_FILES` | `list_files` | `path` | Directory listing (files/dirs) | `src/core/prompts/system-prompt/tools/list_files.ts` | `src/core/task/tools/handlers/ListFilesToolHandler.ts` |
| `LIST_CODE_DEF` | `list_code_definition_names` | `path` | Code symbols (functions, classes, etc.) | `src/core/prompts/system-prompt/tools/list_code_definition_names.ts` | `src/core/task/tools/handlers/ListCodeDefinitionNamesToolHandler.ts` |
| `BASH` | `execute_command` | `command`, `requires_approval`, `timeout` (optional) | stdout + stderr | `src/core/prompts/system-prompt/tools/execute_command.ts` | `src/core/task/tools/handlers/ExecuteCommandToolHandler.ts:22–240` |
| `BROWSER` | `browser_action` | `action`, `coordinate`, `url`, `text` | Screenshot or page state | `src/core/prompts/system-prompt/tools/browser_action.ts` | `src/core/task/tools/handlers/BrowserToolHandler.ts` |
| `WEB_SEARCH` | `web_search` | `query`, `allowed_domains`, `blocked_domains` | Markdown search results | `src/core/prompts/system-prompt/tools/web_search.ts` | `src/core/task/tools/handlers/WebSearchToolHandler.ts` |
| `WEB_FETCH` | `web_fetch` | `url`, `prompt` | Extracted content + analysis | `src/core/prompts/system-prompt/tools/web_fetch.ts` | `src/core/task/tools/handlers/WebFetchToolHandler.ts` |
| `MCP_USE` | `use_mcp_tool` | `server_name`, `tool_name`, `arguments` (JSON) | Tool result (string or structured) | `src/core/prompts/system-prompt/tools/use_mcp_tool.ts` | `src/core/task/tools/handlers/UseMcpToolHandler.ts` |
| `MCP_ACCESS` | `access_mcp_resource` | `server_name`, `uri` | Resource content | `src/core/prompts/system-prompt/tools/access_mcp_resource.ts` | `src/core/task/tools/handlers/AccessMcpResourceHandler.ts` |
| `MCP_DOCS` | `load_mcp_documentation` | `server_name` | Markdown documentation | `src/core/prompts/system-prompt/tools/load_mcp_documentation.ts` | `src/core/task/tools/handlers/LoadMcpDocumentationHandler.ts` |
| `ASK` | `ask_followup_question` | `question` | User text response | `src/core/prompts/system-prompt/tools/ask_followup_question.ts` | `src/core/task/tools/handlers/AskFollowupQuestionToolHandler.ts` |
| `ATTEMPT` | `attempt_completion` | `result`, `summary` | Task closure marker | `src/core/prompts/system-prompt/tools/attempt_completion.ts` | `src/core/task/tools/handlers/AttemptCompletionHandler.ts` |
| `APPLY_PATCH` | `apply_patch` | `path`, `diff` | Patch application result | `src/core/prompts/system-prompt/tools/apply_patch.ts` | `src/core/task/tools/handlers/ApplyPatchHandler.ts` |
| `NEW_RULE` | `new_rule` | `title`, `description` | Rule ID or error | `src/core/prompts/system-prompt/tools/new_rule.ts` | `src/core/task/tools/handlers/WriteToFileToolHandler.ts` (shared) |
| `GENERATE_EXPLANATION` | `generate_explanation` | *(none required)* | Inline diff comments | `src/core/prompts/system-prompt/tools/generate_explanation.ts` | `src/core/task/tools/handlers/GenerateExplanationToolHandler.ts` |
| `USE_SKILL` | `use_skill` | `skill_name`, `input` | Skill execution result | `src/core/prompts/system-prompt/tools/use_skill.ts` | `src/core/task/tools/handlers/UseSkillToolHandler.ts` |
| Other mode/response tools (8 total) | `plan_mode_respond`, `act_mode_respond`, `new_task`, `condense`, `summarize_task`, `report_bug`, `focus_chain` | Variant | Variant | `src/core/prompts/system-prompt/tools/` | `src/core/task/tools/handlers/` |

**Tool Registry**: `src/core/prompts/system-prompt/registry/ClineToolSet.ts:7–150`
- `ClineToolSet.getTools(variant: ModelFamily)` → returns all tools for variant
- `ClineToolSet.getToolByNameWithFallback(name, variant)` → lookup with fallback to GENERIC
- `ClineToolSet.getEnabledTools(variant, context)` → filtered by context requirements (MCP availability, etc.)

---

## 3. EXECUTION PIPELINE

### 3.1 High-Level Flow

```
Model Output (XML tool blocks)
    ↓
parseAssistantMessageV2()
    ↓ [extract <tool_name>...</tool_name> tags]
ToolUse[] { name, params, partial, call_id }
    ↓
Task.presentAssistantMessage()
    ↓ [switch on ToolUse.type === "tool_use"]
ToolExecutor.executeTool(block)
    ↓
ToolExecutor.execute(block)  [validation, approval checks]
    ├─ [if block.partial] handlePartialBlock() [UI update only]
    └─ [if block.complete] handleCompleteBlock() [run tool]
        ├─ [auto-approve?] skip approval modal
        ├─ [else] ToolResultUtils.askApprovalAndPushFeedback() [wait for user]
        ├─ [if approved or auto] run PreToolUse hook
        ├─ ToolExecutorCoordinator.execute()
        │  └─ [route to handler] handler.execute(config, block)
        ├─ ToolResultUtils.pushToolResult() [add to userMessageContent]
        └─ [if enabled] run PostToolUse hook
    ↓
userMessageContent pushed to Anthropic API (next message)
    ↓
Model consumes tool result as context
```

### 3.2 Parser: Assistant Message → Tool Blocks

**File**: `src/core/assistant-message/parse-assistant-message.ts:parseAssistantMessageV2()`

Extracts XML-tagged tool calls from assistant response:
```xml
<read_file><path>src/index.ts</path></read_file>
<write_to_file><path>file.txt</path><content>Hello</content></write_to_file>
```

Returns: `AssistantMessageContent[]` containing `ToolUse` objects
- `type: "tool_use"`
- `name: ClineDefaultTool` (enum)
- `params: Record<ToolParamName, string>` (all param values are strings from XML text)
- `partial: boolean` (set during streaming)
- `call_id?: string` (for Anthropic native tool calls)
- `isNativeToolCall?: boolean` (Anthropic/OpenAI native format)

### 3.3 Main Orchestrator: Task Class

**File**: `src/core/task/index.ts:presentAssistantMessage()` (line ~2143)

Entry point:
```typescript
case "tool_use":
  await this.toolExecutor.executeTool(block)
```

### 3.4 Executor: ToolExecutor Class

**File**: `src/core/task/ToolExecutor.ts:55–405`

Key methods:
- **`executeTool(block: ToolUse)`** (public entry point, line ~245)
  - Delegates to `execute(block)` after creating task config

- **`execute(block: ToolUse): Promise<boolean>`** (lines 341–405)
  1. **Validation**: Check tool registered with coordinator (line 345)
  2. **Rejection checks**: Skip if user rejected previous tool (lines 352–359)
  3. **Parallel tool check**: Reject if tool already used in this message (lines 361–368)
  4. **Plan mode check**: Reject file modification tools in plan mode (lines 370–385)
  5. **Close browser** for non-browser tools (lines 387–390)
  6. **Route**:
     - If `block.partial` → `handlePartialBlock()` (UI streaming)
     - If `block.complete` → `handleCompleteBlock()` (execute tool)

- **`handlePartialBlock(block, config): Promise<void>`** (lines 546–549)
  - Calls handler's `handlePartialBlock()` if it implements `IPartialBlockHandler`
  - **No results pushed** during partial (UI-only updates)

- **`handleCompleteBlock(block, config): Promise<void>`** (lines 552–621)
  1. Auto-approval check via `shouldAutoApproveToolWithPath()`
  2. If **auto-approved**: `config.callbacks.say("tool", message)`
  3. If **manual approval required**:
     - `ToolResultUtils.askApprovalAndPushFeedback()` → wait for modal response
     - If rejected: set `taskState.didRejectTool = true` → skip remaining tools
     - If approved: continue
  4. **PreToolUse hook** (if enabled): `ToolHookUtils.runPreToolUseIfEnabled(config, block)`
  5. **Execute tool**: `coordinator.execute(config, block)`
  6. **Push result**: `pushToolResult(toolResult, block)`
  7. **PostToolUse hook** (if enabled, lines 608–621): observe result, optionally cancel task

### 3.5 Coordinator: ToolExecutorCoordinator

**File**: `src/core/task/tools/ToolExecutorCoordinator.ts`

Routes tool requests to appropriate handler:
```typescript
class ToolExecutorCoordinator {
  private handlers = new Map<ClineDefaultTool, IToolHandler>()

  has(toolName: ClineDefaultTool): boolean
  execute(config: TaskConfig, block: ToolUse): Promise<ToolResponse>
}
```

**Handler Registration** (ToolExecutor.registerToolHandlers(), lines 207–240):
```
ReadFileToolHandler → FILE_READ
WriteToFileToolHandler → FILE_NEW, FILE_EDIT, NEW_RULE
SearchFilesToolHandler → SEARCH
ListFilesToolHandler → LIST_FILES
ListCodeDefinitionNamesToolHandler → LIST_CODE_DEF
ExecuteCommandToolHandler → BASH
BrowserToolHandler → BROWSER
WebFetchToolHandler → WEB_FETCH
WebSearchToolHandler → WEB_SEARCH
UseMcpToolHandler → MCP_USE
AccessMcpResourceHandler → MCP_ACCESS
LoadMcpDocumentationHandler → MCP_DOCS
... (12 more handlers for response/mode tools)
```

### 3.6 Tool Handlers

**Directory**: `src/core/task/tools/handlers/` (24 handler files)

**Interface**: `IFullyManagedTool`
```typescript
interface IFullyManagedTool {
  readonly name: ClineDefaultTool
  execute(config: TaskConfig, block: ToolUse): Promise<ToolResponse>
  getDescription(block: ToolUse): string
  handlePartialBlock?(block: ToolUse, uiHelpers): Promise<void>  // optional
}
```

**Example: ReadFileToolHandler** (lines 18–178)
```typescript
execute(config, block) {
  1. Validate required params: `block.params.path`
  2. Check .clineignore access: `validator.checkClineIgnorePath(relPath)`
  3. Resolve workspace paths (multi-root support)
  4. Auto-approval check: `shouldAutoApproveToolWithPath("read_file", path)`
     - If yes: `config.callbacks.say("tool", message)`
     - If no: `ToolResultUtils.askApprovalAndPushFeedback()`
  5. Run PreToolUse hook
  6. Execute: `extractFileContent(absolutePath, supportsImages)`
  7. Handle image blocks separately
  8. Return file contents (string or mixed content array)
}
```

### 3.7 Result Marshaling

**File**: `src/core/task/tools/utils/ToolResultUtils.ts:17–85`

```typescript
pushToolResult(
  content: ToolResponse,  // string | array of { type, text/source, ... }
  block: ToolUse,
  userMessageContent: any[],
  toolDescription: (block) => string,
  coordinator?: ToolExecutorCoordinator,
  toolUseIdMap?: Map<string, string>
)
```

Logic:
1. Get `tool_use_id` from map (native calls) or default to `"cline"` (backward compat)
2. Check for duplicates
3. If `content` is string:
   - Create `tool_result` block: `{ type: "tool_result", tool_use_id, content }`
4. If `content` is array (mixed blocks):
   - For backward-compat `"cline"` ID: spread directly into `userMessageContent`
   - Otherwise: wrap in `tool_result` block
5. Push to `userMessageContent` array
6. Next API call includes this in conversation history

---

## 4. APPROVAL / PERMISSION MODEL

### 4.1 Two-Tier Approval System

**File**: `src/core/task/tools/autoApprove.ts:8–142`

```typescript
class AutoApprove {
  shouldAutoApproveTool(toolName: ClineDefaultTool): boolean | [boolean, boolean]
  shouldAutoApproveToolWithPath(toolName, path): Promise<boolean>
}
```

#### Tier 1: Setting-Based (No Path Context)

**Return values**:
- Boolean: Single approval setting (e.g., `useBrowser: true`)
- Tuple `[local, external]`: Two-level setting (read/edit local vs. external)

**Settings checked** (from `autoApprovalSettings.actions`):
- `readFiles`, `readFilesExternally`
- `editFiles`, `editFilesExternally`
- `executeSafeCommands`, `executeAllCommands`
- `useBrowser`, `useMcp`

**Yolo mode override** (line 43): If `yoloModeToggled = true`, auto-approve all standard tools.

#### Tier 2: Path-Based (Local vs. External)

**File**: `src/core/task/tools/autoApprove.ts:98–141`

```typescript
async shouldAutoApproveToolWithPath(blockname, autoApproveActionpath) {
  1. Check if path is in workspace:
     - Multi-root: `isLocatedInWorkspace(path)` (any workspace root)
     - Single-root: `isLocatedInPath(cwd, absolutePath)`
  2. Get approval tuple: [localApprove, externalApprove]
  3. Return (isLocalRead && localApprove) || (!isLocalRead && externalApprove)
}
```

### 4.2 Manual Approval Flow

**File**: `src/core/task/tools/utils/ToolResultUtils.ts:125–146`

```typescript
static async askApprovalAndPushFeedback(type: ClineAsk, message: string, config: TaskConfig) {
  1. config.callbacks.ask(type, message, false) → wait for user modal
  2. Response options: "yesButtonClicked" | reject
  3. If rejected: config.taskState.didRejectTool = true
  4. Push user feedback to userMessageContent (if provided)
  5. Return: boolean (approved?)
}
```

**User can provide**:
- Approval/rejection choice
- Feedback text
- Images
- File attachments (processed via `processFilesIntoText()`)

### 4.3 Rejection Cascade

**File**: `src/core/task/ToolExecutor.ts:352–359`

Once user rejects a tool in a message:
```typescript
if (this.taskState.didRejectTool) {
  createToolRejectionMessage(block, reason)
  return true  // Skip execution, don't run other tools
}
```

**Effect**: No further tools in this message batch execute. User must resume task.

### 4.4 Plan Mode Restrictions

**File**: `src/core/task/ToolExecutor.ts:318–418`

```typescript
static PLAN_MODE_RESTRICTED_TOOLS = [
  FILE_NEW, FILE_EDIT, NEW_RULE, APPLY_PATCH
]

if (strictPlanModeEnabled && mode === "plan" && isPlanModeToolRestricted(toolName)) {
  Error: "Tool not available in PLAN MODE"
}
```

User must explicitly switch to ACT MODE to use file modification tools.

---

## 5. SAFETY / BOUNDS ENFORCEMENT

### 5.1 File Size Limits

**File**: `src/integrations/misc/extract-text.ts:57–59`

```typescript
if (fileBuffer.byteLength > 20 * 1000 * 1024) {  // 20 MB
  throw new Error(`File is too large to read into context.`)
}
```

**Applies to**: All text file reads (not images, PDFs, Excel).

**Special handling**:
- **Excel files**: Row limit at 50,000 rows (line 149: `if (rowNumber > 50000)`)
- **Notebooks**: Outputs stripped; cell processing preserved
- **PDFs/DOCX**: Parsed; no explicit byte limit (relies on pdf-parse/mammoth limits)

### 5.2 File Access: .clineignore Controller

**File**: `src/core/ignore/ClineIgnoreController.ts:1–172`

```typescript
class ClineIgnoreController {
  validateAccess(filePath: string): boolean
    → Uses .gitignore-style patterns (via 'ignore' library)
    → Supports !include directives
    → Always allows access if .clineignore doesn't exist

  validateCommand(command: string): string | undefined
    → Checks command for file access (cat, grep, sed, etc.)
    → Returns path being accessed, or undefined if allowed
}
```

**Supported commands monitored**: `cat`, `less`, `more`, `head`, `tail`, `grep`, `awk`, `sed`, `open`, etc.

**Enforcement point**: ReadFileToolHandler (line 68), ExecuteCommandToolHandler (line 139)

### 5.3 Command Permissions: Environment Variable

**File**: `src/core/permissions/CommandPermissionController.ts:28–108`

```typescript
CLINE_COMMAND_PERMISSIONS env var format:
{
  "allow": ["npm *", "git *"],
  "deny": ["rm -rf /"],
  "allowRedirects": false
}
```

**Validation logic** (lines 78–108):
1. Parse command into segments (split by `&&`, `||`, `|`, `;`)
2. Detect dangerous chars (backticks, newlines outside quotes)
3. Check redirects (`>`, `>>`, `<`, etc.) if `allowRedirects !== true`
4. **Validate each segment** against allow/deny patterns (all must pass)
5. Recursively validate subshells

**Enforcement point**: ExecuteCommandToolHandler (lines 119–136)

### 5.4 Parallel Tool Calling

**File**: `src/core/task/ToolExecutor.ts:300–315`

```typescript
isParallelToolCallingEnabled(): boolean {
  return stateManager.getGlobalSettingsKey("enableParallelToolCalling")
         || isGPT5ModelFamily(modelId)
}
```

If disabled (default for non-GPT-5):
- Mark `didAlreadyUseTool = true` after first tool
- Reject subsequent tools: `formatResponse.toolAlreadyUsed(toolName)`

---

## 6. STATE MODEL

### 6.1 Task State

**File**: `src/core/task/TaskState.ts`

```typescript
interface TaskState {
  didRejectTool: boolean                        // User rejected a tool
  didAlreadyUseTool: boolean                    // Tool used in this message (enforced when parallel disabled)
  abort: boolean                                // Task was cancelled
  userMessageContent: any[]                     // Accumulated tool results
  toolUseIdMap: Map<string, string>             // Native call_id → tool_use_id
  consecutiveMistakeCount: number               // Error count (triggers help)
  presentAssistantMessageLocked: boolean
  currentStreamingContentIndex: number
  userMessageContentReady: boolean
}
```

### 6.2 Tool Configuration

**File**: `src/core/task/tools/types/TaskConfig.ts`

```typescript
interface TaskConfig {
  taskId: string
  ulid: string
  cwd: string
  mode: "plan" | "act"
  strictPlanModeEnabled: boolean
  yoloModeToggled: boolean

  taskState: TaskState
  api: ApiHandler
  services: {
    mcpHub, browserSession, urlContentFetcher,
    clineIgnoreController, commandPermissionController,
    ...
  }
  autoApprovalSettings: AutoApprovalSettings
  autoApprover: AutoApprove

  callbacks: {
    say(): void
    ask(): Promise<ClineAskResponse>
    shouldAutoApproveToolWithPath(name, path): Promise<boolean>
    executeCommandTool(cmd, cwd, timeout): Promise<CommandResult>
    ...
  }

  coordinator: ToolExecutorCoordinator
}
```

### 6.3 Auto-Approval Settings

**File**: `src/shared/AutoApprovalSettings.ts`

```typescript
interface AutoApprovalSettings {
  version: number
  enabled: boolean
  actions: {
    readFiles: boolean
    readFilesExternally?: boolean
    editFiles: boolean
    editFilesExternally?: boolean
    executeSafeCommands?: boolean
    executeAllCommands?: boolean
    useBrowser: boolean
    useMcp: boolean
  }
  enableNotifications: boolean
}
```

### 6.4 Pending Tool Actions

**No explicit "pending tool" queue in core** (state is ephemeral during message streaming):
- Tools parsed from model output (not persisted)
- Partial blocks update UI in real-time
- Complete blocks execute immediately or await approval modal
- Results pushed to `taskState.userMessageContent`
- Next API call includes all results in conversation history

**Resumption**: User clicks "Resume" in UI → triggers `presentAssistantMessage()` again with same task context.

---

## 7. CCA ADAPTATION SEAMS

### 7.1 Seam 1: Tool Call Parsing → ToolIntent Generation

**Location**: `src/core/assistant-message/parse-assistant-message.ts` (parseAssistantMessageV2)

**How to inject ToolIntent@v1**:
```typescript
// After extracting ToolUse:
const toolUse = { name: "read_file", params: { path: "..." }, ... }

// Before routing to ToolExecutor.executeTool():
const toolIntent = {
  id: generateUUID(),
  mode: config.mode,  // "plan" | "code" | "review" | "doc" | "submit"
  tool: toolUse.name,
  args: toolUse.params,
  bounds: {
    allowed_paths: getWorkspacePaths(),
    forbidden_paths: getClineIgnorePaths(),
    max_bytes_read: 20 * 1000 * 1024,
    max_bytes_written: Infinity,
    max_files: 1,
    max_time_ms: 30000,
    network: false,
  },
  preconditions: {
    file_digests: {},  // Optional: SHA256 of files being patched
  },
  links: {
    task_id: config.taskId,
    work_id: "...",  // Could derive from conversation ID
  },
}

// Emit/log toolIntent before execution
taskState.pendingToolIntent = toolIntent
```

**Integration point**: Between `parseAssistantMessageV2()` and `Task.presentAssistantMessage()` (around `src/core/task/index.ts:2140–2200`)

### 7.2 Seam 2: Tool Execution → ToolReceipt Generation

**Location**: `src/core/task/ToolExecutor.ts:handleCompleteBlock()` (lines 552–621)

**How to inject ToolReceipt@v1**:
```typescript
// After coordinator.execute() returns toolResult:
const toolResult = await this.coordinator.execute(config, block)

// Create receipt:
const toolReceipt = {
  intent_id: taskState.pendingToolIntent?.id,
  result: toolResult.success ? "success" : "error",
  outputs: {
    stdout: toolResult.stdout || "",
    stderr: toolResult.stderr || "",
    written_files: toolResult.writtenPaths || [],
    read_files: toolResult.readPaths || [],
    search_matches: toolResult.matchCount || 0,
  },
  digests: {
    stdout_sha256: sha256(toolResult.stdout),
    written_file_sha256: {
      "/path/to/file.ts": "abc123...",
    },
  },
  timing: {
    started_at: startTime,
    ended_at: Date.now(),
    execution_ms: Date.now() - startTime,
  },
  host_metadata: {
    hostname: os.hostname(),
    platform: process.platform,
  },
}

// Emit/log receipt
emit("toolReceipt", toolReceipt)
```

**Integration point**: In `ToolExecutor.handleCompleteBlock()` after line 603 (`this.pushToolResult()`)

### 7.3 Seam 3: Task/Work Identifiers

**Current state**: `config.taskId` and `config.ulid` already available:
```typescript
interface TaskConfig {
  taskId: string     // VS Code webview task ID
  ulid: string       // Unique identifier for telemetry
}
```

**To add work_id**: Thread through `Task` constructor → `ToolExecutor` → `TaskConfig`:
```typescript
// In Task.__constructor__:
private workId: string = generateUUID()

// Pass to ToolExecutor:
const toolExecutor = new ToolExecutor(
  ...,
  workId: this.workId,
)

// Add to config:
asToolConfig(): TaskConfig {
  return {
    ...,
    workId: this.workId,  // New field
  }
}
```

---

## 8. MINIMUM MIRROR SET FOR FLOWSTATE MVP

**Select 3–6 tools to implement Flowstate semantics from Cline**:

### 8.1 READ_FILE (Simplest Read-Only)

**Why**: Safe, no approval needed, straightforward bounds.

**Files to mirror**:
1. Tool definition spec: `src/core/prompts/system-prompt/tools/read_file.ts` (lines ~1–100)
2. Handler: `src/core/task/tools/handlers/ReadFileToolHandler.ts` (full file)
3. Approval logic: `src/core/task/tools/autoApprove.ts:shouldAutoApproveToolWithPath()` (lines 98–141)
4. Safety: `.clineignore` validation + 20MB limit

**Flowstate mapping**:
- ToolIntent: `{ mode: "review", tool: "read_file", args: { path }, bounds: { allowed_paths, forbidden_paths, max_bytes_read: 20MB } }`
- ToolReceipt: `{ result: "success", outputs: { stdout: fileContent }, digests: { stdout_sha256: ... } }`

### 8.2 BASH (Most Complex Execution)

**Why**: Demonstrates approval, safety bounds, multi-segment validation.

**Files to mirror**:
1. Tool definition: `src/core/prompts/system-prompt/tools/execute_command.ts`
2. Handler: `src/core/task/tools/handlers/ExecuteCommandToolHandler.ts` (full file, ~240 lines)
3. Command permissions: `src/core/permissions/CommandPermissionController.ts` (full file)
4. Approval: Two-tier (safe vs. all commands)

**Flowstate mapping**:
- ToolIntent: `{ mode: "code", tool: "bash", args: { command, requires_approval, timeout }, bounds: { allowed_paths, forbidden_paths, command_allowlist, command_denylist, max_time_ms: 30000 } }`
- ToolReceipt: `{ result, outputs: { stdout, stderr, exit_code }, timing: { execution_ms } }`

### 8.3 FILE_NEW (Write Tool with Approval)

**Why**: Demonstrates write approval, checkpoint creation, diff tracking.

**Files to mirror**:
1. Handler: `src/core/task/tools/handlers/WriteToFileToolHandler.ts`
2. Approval: `ToolResultUtils.askApprovalAndPushFeedback()` (lines 125–146)
3. Diff tracking: `src/core/task/tools/utils/FileProviderOperations.ts`

**Flowstate mapping**:
- ToolIntent: `{ mode: "code", tool: "write_file", args: { path, content }, bounds: { allowed_paths, forbidden_paths, max_bytes_written } }`
- ToolReceipt: `{ result, digests: { written_file_sha256: { path: sha256 } } }`

### 8.4 SEARCH (Bounded Output)

**Why**: Shows truncation/pagination of large result sets.

**Files to mirror**:
1. Handler: `src/core/task/tools/handlers/SearchFilesToolHandler.ts` (partial)
2. Backend: `src/services/ripgrep/index.ts` (ripgrep subprocess interface)

**Flowstate mapping**:
- ToolIntent: `{ mode: "review", tool: "search", args: { regex, file_pattern }, bounds: { max_results: 1000, max_bytes_output: 100KB } }`
- ToolReceipt: `{ result, outputs: { search_matches: [...], match_count: N } }`

### 8.5 (Optional) ASK (User Interaction)

**Why**: Demonstrates human-in-the-loop.

**Files to mirror**:
1. Handler: `src/core/task/tools/handlers/AskFollowupQuestionToolHandler.ts`
2. Feedback handling: `ToolResultUtils.pushAdditionalToolFeedback()` (lines 90–120)

---

## 9. TOOL PARAMETER NAMES (Canonical List)

All valid parameter names in `src/core/assistant-message/index.ts`:

```
command, requires_approval, path, absolutePath, content, diff, regex,
file_pattern, recursive, action, url, coordinate, text, query,
allowed_domains, blocked_domains, prompt, server_name, tool_name,
arguments, uri, question, options, response, result, context,
title, what_happened, steps_to_reproduce, api_request_output,
additional_context, needs_more_exploration, task_progress, timeout,
input, from_ref, to_ref, skill_name
```

---

## 10. NATIVE TOOL SUPPORT

**File**: `src/core/prompts/system-prompt/registry/ClineToolSet.ts:107–149`

**Native tools enabled only if**:
1. `variant.labels["use_native_tools"] === 1` (set in variant config)
2. `context.enableNativeToolCalls === true`

**Provider converters**:
- **Anthropic/Minimax**: `toolSpecInputSchema()` → Input Schema
- **OpenAI-compatible**: `toolSpecFunctionDefinition()` → ChatCompletionTool
- **Google/Gemini**: `toolSpecFunctionDeclarations()` → FunctionDeclaration

**Includes MCP tools** via `mcpToolToClineToolSpec()` (lines 155–200)

---

## 11. KEY FILES REFERENCE

| Purpose | File Path | Lines | Responsible Component |
|---------|-----------|-------|---------------------|
| Tool enum & constants | `src/shared/tools.ts` | 1–54 | Definitions |
| Parser (XML → ToolUse) | `src/core/assistant-message/parse-assistant-message.ts` | full | Input |
| Main orchestrator | `src/core/task/index.ts` | ~2143 | Task |
| Executor core logic | `src/core/task/ToolExecutor.ts` | 55–621 | Execution |
| Coordinator routing | `src/core/task/tools/ToolExecutorCoordinator.ts` | full | Routing |
| Tool validator | `src/core/task/tools/ToolValidator.ts` | full | Validation |
| Auto-approval | `src/core/task/tools/autoApprove.ts` | 8–142 | Approval |
| Result marshaling | `src/core/task/tools/utils/ToolResultUtils.ts` | 17–146 | Output |
| Hook execution | `src/core/task/ToolExecutor.ts` | 488–532 | Hooks |
| File safety | `src/core/ignore/ClineIgnoreController.ts` | 1–172 | Safety |
| Command safety | `src/core/permissions/CommandPermissionController.ts` | 28–108 | Safety |
| File I/O | `src/core/task/tools/handlers/ReadFileToolHandler.ts` | 18–178 | File ops |
| Command exec | `src/core/task/tools/handlers/ExecuteCommandToolHandler.ts` | 22–240 | Command ops |
| Tool specs | `src/core/prompts/system-prompt/tools/*.ts` | multiple | Specs |
| Tool registry | `src/core/prompts/system-prompt/registry/ClineToolSet.ts` | 7–150 | Registry |
| Text extraction | `src/integrations/misc/extract-text.ts` | 43–64 | File ops |
| Task state | `src/core/task/TaskState.ts` | full | State |
| Task config | `src/core/task/tools/types/TaskConfig.ts` | full | Config |

---

## 12. EVIDENCE SUMMARY

### Claims & File/Line References

| Claim | Evidence |
|-------|----------|
| 24 tools exposed to model | `src/shared/tools.ts:8–35` (ClineDefaultTool enum) |
| Two-tier approval (auto + manual) | `src/core/task/ToolExecutor.ts:341–621` + `src/core/task/tools/autoApprove.ts` |
| File size limit 20MB | `src/integrations/misc/extract-text.ts:57–59` |
| .clineignore access control | `src/core/ignore/ClineIgnoreController.ts:155–172` |
| Command permission env var | `src/core/permissions/CommandPermissionController.ts:53–69` |
| Parallel tool disabling | `src/core/task/ToolExecutor.ts:312–315` |
| Plan mode file restrictions | `src/core/task/ToolExecutor.ts:320–385` |
| Tool rejection cascade | `src/core/task/ToolExecutor.ts:352–359` |
| Hook system (pre/post) | `src/core/task/ToolExecutor.ts:488–621` |
| Result marshaling | `src/core/task/tools/utils/ToolResultUtils.ts:17–85` |
| State model | `src/core/task/TaskState.ts` |
| Coordinator routing | `src/core/task/tools/ToolExecutorCoordinator.ts:7–40` |
| Native tools support | `src/core/prompts/system-prompt/registry/ClineToolSet.ts:128–149` |

---

## END OF INVENTORY

**Generated**: 2026-01-28
**Mode**: READ-ONLY (evidence-first, no modifications)
**Status**: COMPLETE

**For CCA/Flowstate team**: This inventory provides exact line numbers and file paths for:
1. Injecting ToolIntent@v1 creation (seam at parse → execution)
2. Injecting ToolReceipt@v1 creation (seam at execution complete)
3. Threading work_id through config (requires shallow TaskConfig/ToolExecutor changes only)
4. Mirroring READ_FILE, BASH, FILE_NEW, SEARCH as MVP tools
5. All safety bounds: file limits, command patterns, path allowlists, approval gates

**No code changes made**. All claims cite absolute file paths + line ranges.
