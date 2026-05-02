# Hook Examples

Examples for file-based hooks and runtime hooks.

## Hook terminology

Use these terms consistently:

- Runtime hooks: typed in-process plugin/agent lifecycle callbacks such as
  `beforeRun`, `beforeModel`, and `afterTool`.
- File hooks: external scripts discovered from hook config directories and run
  with serialized JSON payloads.
- Hook events: serialized payload names used by file hooks, such as
  `agent_end`, `tool_call`, and `prompt_submit`.

There are two hook layers:

- File hooks are external scripts discovered from hook config directories. They
  use stable serialized event payloads such as `agent_end`, `tool_call`, and
  `prompt_submit`.
- Runtime hooks are in-process lifecycle callbacks used by plugins and core.
  They use runtime names such as `beforeRun`, `beforeModel`, and `afterTool`.

File hooks are an adapter on top of the runtime hook layer. Core discovers hook
files, maps their event names onto runtime hook callbacks, then executes the
matching script with a JSON payload on stdin.

## File hooks vs runtime hooks

| File hook file name | File hook event | Runtime hook backing it |
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

Use file hooks when you want a workspace or user-configured shell/JS/Python
script. Use runtime hooks when you are writing a plugin and need typed,
in-process access to runtime state or want to influence model/tool execution.

`beforeRun` and `afterRun` wrap one runtime `run()` or `continue()` invocation.
In an interactive session, that means one submitted user turn. `afterRun` fires
for completed, aborted, and failed runs; check `result.status` if you only want
successful task completion.

For file hooks, successful task completion maps to the `agent_end` event. For a
plugin, use `afterRun` and check `result.status === "completed"`.

## Completed-task file hook

```bash
mkdir -p .cline/hooks
cp apps/examples/hooks/agent_end.sh .cline/hooks/TaskComplete.sh
chmod +x .cline/hooks/TaskComplete.sh

cline -i "Run the test suite"
```

The hook receives a JSON payload on stdin and writes `{}` to stdout to allow the
run to proceed without changes.

## Custom compaction with a runtime hook

Shell file hooks can observe lifecycle events. Custom message replacement for
compaction needs the runtime request object, so use a TypeScript plugin hook:

```bash
mkdir -p .cline/plugins
cp apps/examples/hooks/custom-compaction-hook.example.ts .cline/plugins/custom-compaction-hook.ts

cline -i "Search the codebase for dispatcher usage, then summarize it"
```

The example uses `hooks.beforeModel` to estimate request size and replace older
middle history with one summary message before the provider request.

This is a runtime hook example, not a `PreCompact` file-hook example. The
`pre_compact` payload type exists for serialized hook events, but `PreCompact`
files are not currently wired into file-hook execution.

### Runtime hook compaction vs message-builder compaction

This example and
[`../plugin-examples/cline-plugin/custom-compaction.example.ts`](../plugin-examples/cline-plugin/custom-compaction.example.ts)
both compact provider-bound messages, but they run at different layers:

| Example | Extension point | Message shape | Best for |
| ------- | --------------- | ------------- | -------- |
| `custom-compaction-hook.example.ts` | `hooks.beforeModel` runtime hook | Agent runtime request messages with runtime parts such as `tool-call`, `tool-result`, `reasoning`, `image`, and `file` | cases that need runtime-hook context, the current runtime snapshot, or direct request mutation |
| `plugin-examples/cline-plugin/custom-compaction.example.ts` | `api.registerMessageBuilder()` | SDK/provider-bound `Message[]` after runtime messages are converted for model delivery | most reusable plugin-owned message rewrites and compaction policies |

Prefer `registerMessageBuilder()` for normal plugin-owned provider-message
rewrites because it runs in the core message pipeline before the built-in
provider-safety builder. Use `beforeModel` when the compaction logic needs
runtime hook context or needs to inspect the exact runtime request object.
