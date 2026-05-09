# Hook Examples

Examples for file-based hooks and runtime hooks.

## Hook Terminology

Use these terms consistently:

- **Runtime hooks**: Typed in-process plugin/agent lifecycle callbacks such as `beforeRun`, `beforeModel`, and `afterTool`.
- **File hooks**: External scripts discovered from hook config directories and run with serialized JSON payloads.
- **Hook events**: Serialized payload names used by file hooks, such as `agent_end`, `tool_call`, and `prompt_submit`.

File hooks are an adapter on top of the runtime hook layer. Core discovers hook files, maps their event names onto runtime hook callbacks, then executes the matching script with a JSON payload on stdin.

## File Hooks vs Runtime Hooks

| File Hook File Name | File Hook Event | Runtime Hook Backing It |
| ------------------- | --------------- | ----------------------- |
| `TaskStart` | `agent_start` | `beforeRun` |
| `TaskResume` | `agent_resume` | `beforeRun` with resume context |
| `UserPromptSubmit` | `prompt_submit` | `beforeRun` plus submitted prompt context |
| `PreToolUse` | `tool_call` | `beforeTool` |
| `PostToolUse` | `tool_result` | `afterTool` |
| `TaskComplete` | `agent_end` | `afterRun` when completed |
| `TaskError` | `agent_error` | `afterRun` when failed |
| `TaskCancel` | `agent_abort` | `afterRun` or session shutdown with abort/cancel reason |
| `SessionShutdown` | `session_shutdown` | session cleanup / runtime shutdown |
| `PreCompact` | not wired for file hooks today | none |

**Use file hooks** when you want a workspace or user-configured shell/Python script. **Use runtime hooks** when writing a plugin and needing typed, in-process access to runtime state or wanting to influence model/tool execution.

`beforeRun` and `afterRun` wrap one runtime `run()` or `continue()` invocation. In an interactive session, that means one submitted user turn. `afterRun` fires for completed, aborted, and failed runs; check `result.status` if you only want successful task completion.

For file hooks, successful task completion maps to the `agent_end` event. For a plugin, use `afterRun` and check `result.status === "completed"`.

## 📂 Examples in This Directory

### Bash Examples

#### `PreToolUse.sh`

Log every tool call and its inputs. Useful for auditing what the agent is about to do.

```bash
mkdir -p .cline/hooks
cp apps/examples/hooks/PreToolUse.sh .cline/hooks/
chmod +x .cline/hooks/PreToolUse.sh
cline -i "do something"  # See tool calls logged to stderr
```

#### `PostToolUse.sh`

Inspect tool results and add supplementary context.

```bash
mkdir -p .cline/hooks
cp apps/examples/hooks/PostToolUse.sh .cline/hooks/
chmod +x .cline/hooks/PostToolUse.sh
cline -i "do something"  # See tool results logged and enriched
```

#### `PreToolUse_BlockDestructive.sh`

Prevent destructive operations like force pushes or bulk deletes.

```bash
mkdir -p .cline/hooks
cp apps/examples/hooks/PreToolUse_BlockDestructive.sh .cline/hooks/PreToolUse.sh
chmod +x .cline/hooks/PreToolUse.sh
cline -i "clean up the repo"  # Destructive operations will be blocked
```

#### `PreToolUse_RequireReview.sh`

Require user review before certain operations (file writes to critical files).

```bash
mkdir -p .cline/hooks
cp apps/examples/hooks/PreToolUse_RequireReview.sh .cline/hooks/PreToolUse.sh
chmod +x .cline/hooks/PreToolUse.sh
cline -i "update dependencies"  # Critical file writes will pause for review
```

#### `PreToolUse_InjectFileContext.sh`

Extract and inject file context before tool execution (related test files, lock files, environment context).

```bash
mkdir -p .cline/hooks
cp apps/examples/hooks/PreToolUse_InjectFileContext.sh .cline/hooks/PreToolUse.sh
chmod +x .cline/hooks/PreToolUse.sh
cline -i "review the configuration"  # Related files will be mentioned automatically
```

#### `TaskStart.sh`, `TaskComplete.sh`, `SessionShutdown.sh`

Track agent session lifecycle events (start, end, shutdown).

```bash
mkdir -p .cline/hooks
cp apps/examples/hooks/TaskStart.sh .cline/hooks/
cp apps/examples/hooks/TaskComplete.sh .cline/hooks/
cp apps/examples/hooks/SessionShutdown.sh .cline/hooks/
chmod +x .cline/hooks/Task*.sh .cline/hooks/SessionShutdown.sh
cline -i "do something"  # Session lifecycle will be logged
```

### Python Examples

#### `PreToolUse.py`

Python-based hook to log and filter tool calls.

```bash
mkdir -p .cline/hooks
cp apps/examples/hooks/PreToolUse.py .cline/hooks/
chmod +x .cline/hooks/PreToolUse.py
cline -i "do something"  # Python hook will log tool calls
```

#### `PostToolUse.py`

Python-based post-tool-use hook for result enrichment.

```bash
mkdir -p .cline/hooks
cp apps/examples/hooks/PostToolUse.py .cline/hooks/
chmod +x .cline/hooks/PostToolUse.py
cline -i "do something"  # Python hook will enrich tool results
```

#### `PreToolUse_InjectContext.py`

Python-based context injection with file analysis (test files, config files, lock files, Node.js version, git branch).

```bash
mkdir -p .cline/hooks
cp apps/examples/hooks/PreToolUse_InjectContext.py .cline/hooks/PreToolUse.py
chmod +x .cline/hooks/PreToolUse.py
cline -i "add a new feature"  # Related files and environment will be injected
```

### TypeScript Examples

#### `PreToolUse.ts`

TypeScript hook for advanced tool call filtering and logging.

```bash
mkdir -p .cline/hooks
cp apps/examples/hooks/PreToolUse.ts .cline/hooks/
chmod +x .cline/hooks/PreToolUse.ts
cline -i "do something"  # TypeScript hook will execute via bun
```

#### `PostToolUse.ts`

TypeScript hook for post-execution actions.

```bash
mkdir -p .cline/hooks
cp apps/examples/hooks/PostToolUse.ts .cline/hooks/
chmod +x .cline/hooks/PostToolUse.ts
cline -i "do something"  # TypeScript hook will execute via bun
```

#### `PreToolUse_ModifyInput.ts`

Modify tool inputs before execution (normalize paths, add defaults, sanitize).

```bash
mkdir -p .cline/hooks
cp apps/examples/hooks/PreToolUse_ModifyInput.ts .cline/hooks/PreToolUse.ts
chmod +x .cline/hooks/PreToolUse.ts
cline -i "install dependencies"  # npm install will have --save-exact added automatically
```

## Getting Started

### 1. Copy a hook to your project

**File hooks** go in `.cline/hooks/` and must be named after the event they handle:

```bash
mkdir -p .cline/hooks

# Copy PreToolUse example (pick your language)
cp apps/examples/hooks/PreToolUse.sh .cline/hooks/PreToolUse.sh      # Bash
cp apps/examples/hooks/PreToolUse.py .cline/hooks/PreToolUse.py      # Python
cp apps/examples/hooks/PreToolUse.ts .cline/hooks/PreToolUse.ts      # TypeScript

# Copy PostToolUse example
cp apps/examples/hooks/PostToolUse.sh .cline/hooks/PostToolUse.sh    # Bash
cp apps/examples/hooks/PostToolUse.py .cline/hooks/PostToolUse.py    # Python
cp apps/examples/hooks/PostToolUse.ts .cline/hooks/PostToolUse.ts    # TypeScript
```

### 2. Make it executable

```bash
chmod +x .cline/hooks/PreToolUse.*
chmod +x .cline/hooks/PostToolUse.*
```

### 3. Test it

```bash
cline -i "test prompt"
# Or load from a custom hooks directory:
cline --hooks-dir ./my-hooks -i "test prompt"
```

## Hook Input/Output Format

All hooks receive a detailed JSON event on stdin and must return JSON on stdout.

### Input

**PreToolUse event:**
```json
{
  "hookName": "tool_call",
  "clineVersion": "1.0.0",
  "timestamp": "2026-01-15T10:30:00Z",
  "taskId": "conv-123",
  "workspaceRoots": ["/path/to/repo"],
  "userId": "user",
  "iteration": 1,
  "tool_call": {
    "id": "call-456",
    "name": "read_files",
    "input": {"filePath": "/path/to/file.ts"}
  }
}
```

**PostToolUse event:**
```json
{
  "hookName": "tool_result",
  "clineVersion": "1.0.0",
  "timestamp": "2026-01-15T10:30:00Z",
  "tool_result": {
    "id": "call-456",
    "name": "read_files",
    "input": {"filePath": "/path/to/file.ts"},
    "output": "file contents here",
    "error": null,
    "durationMs": 45
  }
}
```

**TaskStart and other lifecycle events:**
```json
{
  "hookName": "agent_start",
  "clineVersion": "1.0.0",
  "timestamp": "2026-01-15T10:30:00Z",
  "taskId": "conv-123",
  "workspaceRoots": ["/path/to/repo"],
  "userId": "user"
}
```

### Output

Return a JSON object from stdout. Empty `{}` means "do nothing."

**Available fields:**

| Field | Type | Effect | Event(s) |
|-------|------|--------|----------|
| `cancel` | boolean | Cancels the pending tool call | `PreToolUse` |
| `review` | boolean | Pauses and prompts for user review | `PreToolUse` |
| `context` | string | Injects context into agent's next turn | `PreToolUse`, `PostToolUse` |
| `errorMessage` | string | Surfaces an error to the agent | `PreToolUse` |
| `overrideInput` | object | Replaces tool input before execution | `PreToolUse` |

## Common Patterns

### Log and proceed (bash)
```bash
#!/usr/bin/env bash
input=$(cat)
tool=$(echo "$input" | jq -r '.tool_call.name')
echo "Action: $tool" >&2
echo '{}'
```

### Inject context into next turn
```bash
#!/usr/bin/env bash
input=$(cat)
tool=$(echo "$input" | jq -r '.tool_call.name')
if [ "$tool" = "run_commands" ]; then
  branch=$(git branch --show-current 2>/dev/null)
  echo "{\"context\": \"Current branch: $branch\"}"
else
  echo '{}'
fi
```

### Modify tool input before execution
```bash
#!/usr/bin/env bash
input=$(cat)
tool=$(echo "$input" | jq -r '.tool_call.name')
file=$(echo "$input" | jq -r '.tool_call.input.filePath')

if [ "$tool" = "read_files" ] && [[ $file == ~/* ]]; then
  normalized="${file/#\~/$HOME}"
  echo "{\"overrideInput\": {\"filePath\": \"$normalized\"}}"
else
  echo '{}'
fi
```

### Block specific tools or commands
```bash
#!/usr/bin/env bash
input=$(cat)
tool=$(echo "$input" | jq -r '.tool_call.name')
cmd=$(echo "$input" | jq -r '.tool_call.input.command // empty')

if [ "$tool" = "run_commands" ] && [[ $cmd =~ git\ push\ --force ]]; then
  echo '{"cancel": true, "errorMessage": "Force push is blocked."}'
else
  echo '{}'
fi
```

### Require review for sensitive files
```bash
#!/usr/bin/env bash
input=$(cat)
tool=$(echo "$input" | jq -r '.tool_call.name')
file=$(echo "$input" | jq -r '.tool_call.input.filePath // empty')

if ([ "$tool" = "editor" ] || [ "$tool" = "write_file" ]) && \
   [[ $file =~ (package\.json|\.env|secrets|tsconfig) ]]; then
  echo '{"review": true, "context": "This will modify a critical file"}'
else
  echo '{}'
fi
```

### Python: Parse and manipulate JSON
```python
#!/usr/bin/env python3
import sys
import json

event = json.load(sys.stdin)
tool_name = event.get("tool_call", {}).get("name", "")
tool_input = event.get("tool_call", {}).get("input", {})

if tool_name == "read_files":
    file_path = tool_input.get("filePath", "")
    if file_path.endswith(".test.ts"):
        print(json.dumps({"context": "This is a test file"}))
    else:
        print(json.dumps({}))
else:
    print(json.dumps({}))
```

### TypeScript: Type-safe hook with async operations
```typescript
#!/usr/bin/env bun
interface HookEvent {
  tool_call: { name: string; input: Record<string, unknown> };
}

const event: HookEvent = JSON.parse(await Bun.stdin.text());
const toolName = event.tool_call.name;

if (toolName === "run_commands") {
  const branch = await getGitBranch();
  console.log(JSON.stringify({ context: `Branch: ${branch}` }));
} else {
  console.log(JSON.stringify({}));
}

async function getGitBranch(): Promise<string> {
  return "main";
}
```

## Debugging Hooks

### Print hook invocations
```bash
cline --verbose "your prompt"
```

### Test a hook manually
```bash
echo '{"tool_call": {"name": "read_files", "input": {"filePath": "test.ts"}}}' | .cline/hooks/PreToolUse.sh
```

### Check hook output
```bash
.cline/hooks/PreToolUse.sh < input.json | jq .
```

## Runtime Hooks: Custom Compaction

File hooks observe lifecycle events. For more advanced use cases like message compaction, use a TypeScript **runtime hook** plugin:

```bash
mkdir -p .cline/plugins
cp apps/examples/hooks/custom-compaction-hook.example.ts .cline/plugins/custom-compaction-hook.ts

cline -i "Search the codebase for dispatcher usage, then summarize it"
```

This example uses `hooks.beforeModel` to estimate request size and replace older middle history with a summary message before the provider request.

### Runtime Hook vs Message-Builder Compaction

| Example | Extension Point | Message Shape | Best For |
| ------- | --------------- | ------------- | -------- |
| `custom-compaction-hook.example.ts` (in `.cline/plugins/`) | `hooks.beforeModel` runtime hook | Agent runtime request messages with runtime parts such as `tool-call`, `tool-result`, `reasoning`, `image`, and `file` | Cases needing runtime-hook context, current runtime snapshot, or direct request mutation |
| `plugin-examples/cline-plugin/custom-compaction.example.ts` | `api.registerMessageBuilder()` | SDK/provider-bound `Message[]` after runtime messages are converted for model delivery | Most reusable plugin-owned message rewrites and compaction policies |

**Prefer `registerMessageBuilder()`** for normal plugin-owned provider-message rewrites because it runs in the core message pipeline before the built-in provider-safety builder. **Use `beforeModel`** when the compaction logic needs runtime hook context or needs to inspect the exact runtime request object.

## Tips

- **Hooks are disabled in `--yolo` mode** — use `--act` or `--plan` to enable them
- **Use stderr for logging** — stdout is reserved for JSON output
- **Keep hooks fast** — they run before every tool call, so performance matters
- **Test with `jq`** — JSON parsing is finicky; use `jq` for safe extraction
- **Use multiple hooks** — different event files can coexist in `.cline/hooks/`
- **Load from custom dirs** — use `--hooks-dir ./ci/hooks` to load from elsewhere
