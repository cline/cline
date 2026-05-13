# Design Doc: Foreground Terminal Integration (SDK Port)

> **⚠️ Remove this file before merging the final PR.**

**Author:** AI-assisted design session  
**Date:** 2026-05-01  
**Status:** Approved for implementation  
**Branch:** `sdk-migration-pt7`

---

## Background

The Cline VSCode extension was reverted to include foreground terminals ([#10477](https://github.com/cline/cline/pull/10477), commit `beb3ad78d`) because users depend on them for:

1. **Interactive CLI testing** — users need a real terminal to interact with
2. **Long-running dev servers** — `npm run dev`, `cargo watch`, etc. that run indefinitely; users manage them with ctrl-C
3. **Visibility** — users want to see what Cline is doing in the terminal

The SDK migration branch (`sdk-migration-pt7`) replaced the classic `Controller` and `Task` system with the SDK's `ClineCore` / `VscodeSessionHost`. The rebase onto `origin/main` brought back the foreground terminal infrastructure (settings UI, `VscodeTerminalManager`, state keys), but the SDK controller doesn't wire any of it. This design doc describes how to integrate the foreground terminal as an **IDE feature built on top of the SDK**, not as part of the SDK itself.

---

## Problem: The SDK's Built-in `run_commands` Is Insufficient

The SDK provides a `run_commands` tool backed by a `BashExecutor` (`child_process.spawn`). It has fundamental limitations:

| Requirement | SDK's `run_commands` | Verdict |
|---|---|---|
| Long-running processes | ❌ `withTimeout()` kills after 30s (executor) / 60s (tool) | Blocker |
| "Proceed While Running" | ❌ Tool blocks until executor returns `Promise<string>` | Blocker |
| Interactive use (ctrl-C, prompts) | ❌ `child_process.spawn` is non-interactive | Blocker |
| Visible terminal | ❌ Runs invisibly in background | Blocker |
| Real-time output streaming | ❌ Collects all output, returns at end | Missing feature |

**Key detail on timeouts:** The SDK's built-in tools apply their own `withTimeout()` inside `execute()`. The `timeoutMs` property on the `Tool` interface is metadata — the `AgentRuntime` does **NOT** enforce it externally (`agent-runtime.ts:948` calls `tool.execute()` directly). This means a custom tool that omits `withTimeout()` can run indefinitely.

---

## Solution: Replace `run_commands` With Our Own Tool

### Architecture

```
suppress SDK's built-in run_commands
    └── defaultToolExecutors: { bash: undefined }
        → createDefaultTools() sees falsy bash → doesn't create run_commands

provide custom run_commands via extraTools
    └── src/sdk/vscode-run-commands-tool.ts (NEW)
        ├── reads vscodeTerminalExecutionMode from StateManager on EVERY call
        │
        ├── foreground path ("vscodeTerminal"):
        │   └── VscodeTerminalManager → VscodeTerminalProcess
        │       • Visible VS Code terminal
        │       • Shell integration output capture
        │       • No timeout — runs until completion or cancellation
        │       • onChange/emitUpdate for streaming output to chat
        │
        └── background path ("backgroundExec"):
            └── createBashExecutor() from @cline/core
                • Same implementation SDK would use
                • Configurable timeout (default 5min)
```

### Suppression Mechanism

In `VscodeSessionHost.create()`, pass `defaultToolExecutors: { bash: undefined }`. The SDK's `DefaultRuntimeBuilder.build()` does:
```typescript
const executors = { ...createDefaultExecutors(), ...(defaultToolExecutors ?? {}) }
```
The spread sets `bash` to `undefined`. Then `createDefaultTools()` checks `enableBash && executors.bash` — falsy bash means no `run_commands` tool is created.

### Dynamic Foreground/Background Switching

The tool reads the setting on every invocation — no session restart needed:
```typescript
execute: async (input, context, onChange) => {
    const mode = stateManager.getGlobalStateKey("vscodeTerminalExecutionMode")
    if (mode === "backgroundExec") {
        return backgroundExecutor(command, cwd, context)
    } else {
        return foregroundExecute(command, cwd, context, onChange)
    }
}
```

For background mode, we reuse `createBashExecutor()` from `@cline/core` — the exact same proven `child_process.spawn` implementation the SDK uses internally.

### Real-Time Output Streaming via `onChange`/`emitUpdate`

The pipeline is fully wired:

1. **Tool** calls `onChange({ type: "output", line: "..." })` as terminal output arrives
2. **Adapter** (`toolToAgentTool`) passes `context.emitUpdate` as the `onChange` argument
3. **AgentRuntime** emits `{ type: "tool-updated", toolCall, update }` event
4. **Session event adapter** translates to `{ type: "content_update", contentType: "tool", toolName, toolCallId, update }`
5. **Message translator** handles the event and produces visible chat messages
6. **Webview** renders the output in real-time

Current gap: The message translator ignores `content_update` for non-`spawn_agent` tools (line 866-869). This needs a small fix to handle `run_commands` updates.

---

## What We Reuse

| Component | Status | Plan |
|---|---|---|
| `VscodeTerminalManager` | ✅ Present (from revert) | Use directly |
| `VscodeTerminalProcess` | ✅ Present (from revert) | Use directly |
| `VscodeTerminalRegistry` | ✅ Present (from revert) | Use directly |
| `CommandOrchestrator` | ✅ Present | Adapt for "Proceed While Running" |
| `CommandExecutor` | ✅ Present | Study patterns, don't reuse directly (classic Task callbacks) |
| Terminal settings UI | ✅ Present (from revert) | Use as-is |
| State keys | ✅ Present (from revert) | Use as-is |
| `createBashExecutor` | ✅ SDK export | Use for background path |

---

## Implementation Plan

### First Commit

1. **Create `src/sdk/vscode-run-commands-tool.ts`** — Custom `run_commands` tool factory
   - Parses all SDK input formats (string, array, `{commands:[...]}`)
   - Dynamic foreground/background dispatch
   - Foreground: `VscodeTerminalManager`, no timeout, `onChange` for output streaming
   - Background: `createBashExecutor()` with configurable timeout
   - Respects `context.signal` (AbortSignal) for cancellation

2. **Modify `src/sdk/vscode-session-host.ts`** — Wire the new tool
   - Pass `defaultToolExecutors: { bash: undefined }` to suppress SDK's `run_commands`
   - Read terminal settings from StateManager
   - Instantiate `VscodeTerminalManager` lazily
   - Add custom tool to `extraTools` in `createVscodeExtraTools()`

3. **Wire terminal settings RPC** — Ensure `setTerminalExecutionMode` and terminal settings work with SDK controller

4. **Verify settings UI** — Confirm `TerminalSettingsSection` reads/writes settings

### Follow-Up Work

- "Proceed While Running" button (adapt `CommandOrchestrator` callbacks)
- Message translator handling for `content_update` on `run_commands` → chat output rows
- Background command tracking and environment details summary
- Shell integration failure suggestion ("try background exec mode")
- `attempt_completion` command execution in foreground terminal

---

## Alternatives Considered

### ❌ Custom `BashExecutor` injected via `defaultToolExecutors.bash`

Would reuse the SDK's `run_commands` tool wrapper, but that wrapper applies `withTimeout()` (30s/60s) that kills long-running processes. No way to disable it from outside. Also no mechanism for "Proceed While Running" or streaming since the tool blocks on the executor's `Promise<string>`.

### ❌ Forking the SDK's `run_commands` tool definition

Higher maintenance burden. Our tool needs fundamentally different execution semantics, not a minor tweak.

### ✅ Suppress + Replace (chosen approach)

Clean separation. The SDK owns its headless `run_commands` for CLI/non-IDE use. The VSCode extension provides its own terminal-aware replacement via the SDK's `extraTools` extension point. Dynamic switching between foreground/background happens inside our tool.
