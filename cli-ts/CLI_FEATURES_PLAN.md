# CLI Features Implementation Plan

Based on the cline.1.md man page, this document outlines the implementation plan for all CLI features. The Cline man page indicates that cline cli runs as a client-server architecture where **Cline Core** runs as a standalone service, but for the typescript version of the CLI, that won't be the case. The Typescript CLI will just import the necessary objects it needs from cline core src directly.

## Overview

The TypeScript CLI scaffold is complete. This plan covers implementing the full feature set from the man page, prioritized by dependency order and user value.

---

## Phase 1: Core Infrastructure (Prerequisites)
**Status: ✅ Completed (tests passing)**

### 1.1 Output Formatting System
**Priority: High** | **Complexity: Medium**

Implement the `-F/--output-format` global option to support `rich`, `json`, and `plain` output formats.

**Files to create:**
- `cli-ts/src/core/output/formatter.ts` - Base formatter interface
- `cli-ts/src/core/output/rich-formatter.ts` - Rich terminal output with colors/styling
- `cli-ts/src/core/output/json-formatter.ts` - JSON output for scripting
- `cli-ts/src/core/output/plain-formatter.ts` - Plain text output

**Types:**
```typescript
interface OutputFormatter {
  message(msg: ClineMessage): void
  error(err: Error): void
  success(text: string): void
  table(data: Record<string, unknown>[]): void
  list(items: string[]): void
}

interface ClineMessage {
  type: 'ask' | 'say'
  text: string
  ts: number // Unix epoch milliseconds
  reasoning?: string
  say?: string // say subtype
  ask?: string // ask subtype
  partial?: boolean
  images?: string[]
  files?: string[]
  lastCheckpointHash?: string
  isCheckpointCheckedOut?: boolean
  isOperationOutsideWorkspace?: boolean
}
```

**Tests:**
- JSON formatter outputs valid JSON per message
- Rich formatter uses colors when TTY available
- Plain formatter strips all formatting

---

### 1.2 Configuration System
**Priority: High** | **Complexity: Medium**

Implement persistent configuration storage and the `cline config` command group.

**Commands:**
- `cline config set <key> <value>`
- `cline config get <key>`
- `cline config list`

**Files to create:**
- `cli-ts/src/core/config-storage.ts` - Persistent config storage (JSON file in ~/.cline)
- `cli-ts/src/commands/config/index.ts` - Config command group
- `cli-ts/src/commands/config/set.ts`
- `cli-ts/src/commands/config/get.ts`
- `cli-ts/src/commands/config/list.ts`

**Config storage location:** `~/.cline/config.json`

**Tests:**
- Config persists across CLI invocations
- Config values can be overridden
- Invalid keys produce helpful errors

---

### 1.3 Instance Registry & Lifecycle (DEPRECATED -- DO NOT IMPLEMENT)
**Priority: Deprecated** | **Complexity: High**

Implement the instance management system for tracking running Cline Core instances.

**Files to create:**
- `cli-ts/src/core/instance-registry.ts` - Track running instances (SQLite or JSON)
- `cli-ts/src/core/instance-client.ts` - gRPC client for communicating with Cline Core
- `cli-ts/src/commands/instance/index.ts` - Instance command group
- `cli-ts/src/commands/instance/new.ts`
- `cli-ts/src/commands/instance/list.ts`
- `cli-ts/src/commands/instance/default.ts`
- `cli-ts/src/commands/instance/kill.ts`

**Commands:**
- `cline instance new [--default]` / `cline i n`
- `cline instance list` / `cline i l`
- `cline instance default <address>` / `cline i d`
- `cline instance kill <address> [--all]` / `cline i k`

**Architecture notes:**
- The CLI spawns `cline-core` as a child process
- Instances are tracked in `~/.cline/instances.json` with addresses and PIDs
- Default instance is stored in config

**Tests:**
- New instance spawns cline-core process
- List shows all running instances
- Kill terminates specific or all instances
- Default instance is used when --address not specified

---

## Phase 2: Authentication
**Status: ✅ Completed (tests passing)**

### 2.1 Auth Command
**Priority: High** | **Complexity: Medium**

Implement provider authentication system.

**Commands:**
- `cline auth [provider] [key]` / `cline a`

**Files to create:**
- `cli-ts/src/commands/auth/index.ts` - Auth command with interactive wizard
- `cli-ts/src/core/auth/providers.ts` - Provider definitions (Anthropic, OpenRouter, etc.)
- `cli-ts/src/core/auth/wizard.ts` - Interactive provider selection
- `cli-ts/src/core/auth/oauth.ts` - OAuth flow handler (for providers that support it)

**Behavior:**
- No args: Launch interactive wizard
- Provider only: Prompt for key or launch OAuth
- Provider + key: Store key directly

**Storage:** Keys stored in `~/.cline/secrets.json` (with appropriate permissions)

**Tests:**
- Interactive wizard presents provider choices
- API keys are securely stored
- Keys can be updated

---

## Phase 3: Task Management
**Status: ✅ Completed (207 tests passing)**

### 3.1 Task Command Group Base
**Priority: High** | **Complexity: Medium** | **Status: ✅ Complete**

Implement the task command infrastructure.

**Files created:**
- `cli-ts/src/commands/task/index.ts` - Task command group
- `cli-ts/src/core/task-client.ts` - Task storage and management
- `cli-ts/src/types/task.ts` - Task-related types

**Commands:**
- `cline task` / `cline t` - Display help

---

### 3.2 Task Creation & History
**Priority: High** | **Complexity: Medium** | **Status: ✅ Complete**

**Commands:**
- `cline task new <prompt> [options]` / `cline t n`
- `cline task list` / `cline t l` / `cline t ls`
- `cline task open <task-id>` / `cline t o`

**Files created:**
- `cli-ts/src/commands/task/new.ts`
- `cli-ts/src/commands/task/list.ts`
- `cli-ts/src/commands/task/open.ts`

**Options for task new/open:**
- `-s, --setting <key=value>` - Override settings (repeatable)
- `-y, --yolo` / `--no-interactive` - Autonomous mode
- `-m, --mode <mode>` - Starting mode (act/plan)
- `-w, --workspace <path>` - Working directory (new only)

**Options for task list:**
- `-n, --limit <number>` - Limit results (default: 20)
- `-a, --all` - Show all tasks
- `--status <status>` - Filter by status

**Tests (53 new tests):**
- ✅ TaskStorage: create, get, update, delete, list, findByPartialId
- ✅ task new: creates task, validates mode, parses settings
- ✅ task list: shows history, respects limit, filters by status, JSON output
- ✅ task open: finds by full/partial ID, overrides mode/settings, resumes paused tasks

---

### 3.3 Task Communication - Embedded Controller Architecture
**Priority: High** | **Complexity: High**

**Architecture Decision: In-Process Embedded Controller**

The CLI chat REPL will embed the Cline Controller directly in the CLI process (not via gRPC). This approach:
- Uses direct method calls instead of gRPC serialization
- Reuses infrastructure from `src/standalone/cline-core.ts`
- Shares state via `~/.cline/` with VSCode extension
- Outputs to terminal instead of webview

```
┌──────────────────────────────────────────────────────────┐
│                    CLI Process                            │
│                                                          │
│  ┌────────────┐    ┌────────────┐    ┌──────────────────┐│
│  │  CLI Chat  │───>│ Controller │───>│ Task + AI API    ││
│  │   REPL     │<───│            │<───│                  ││
│  └────────────┘    └────────────┘    └──────────────────┘│
│        │                 │                               │
│        v                 v                               │
│  ┌────────────┐    ┌──────────────┐                     │
│  │  Terminal  │    │ StateManager │                     │
│  │   Output   │    │ (~/.cline/)  │                     │
│  └────────────┘    └──────────────┘                     │
└──────────────────────────────────────────────────────────┘
```

**Key Source Files to Understand:**
- `src/core/controller/index.ts` - Controller class with initTask(), cancelTask(), postStateToWebview()
- `src/standalone/cline-core.ts` - Shows how to run Controller outside VSCode
- `src/standalone/vscode-context.ts` - initializeContext() creates mock ExtensionContext
- `src/standalone/protobus-service.ts` - Shows Controller methods exposed via gRPC
- `src/generated/hosts/standalone/protobus-server-setup.ts` - All available RPC methods

**Key Controller Methods for CLI:**
- `controller.initTask(prompt)` - Start a new task with prompt
- `controller.task?.handleWebviewAskResponse('messageResponse', userInput)` - Send user input
- `controller.task?.messageStateHandler.getClineMessages()` - Get conversation messages
- `controller.cancelTask()` - Cancel current task
- `controller.getStateToPostToWebview()` - Get full state (clineMessages, etc.)

**Commands:**
- `cline task chat` / `cline t c` - Interactive chat mode with embedded Controller
- `cline task send [message] [options]` / `cline t s` - Send single message
- `cline task view [--follow] [--follow-complete]` / `cline t v` - View/stream conversation

**Files to create/modify:**
- `cli-ts/src/core/embedded-controller.ts` - Initialize Controller in CLI process
- `cli-ts/src/core/cli-webview-adapter.ts` - Adapter that outputs to terminal instead of webview
- `cli-ts/src/commands/task/chat.ts` - Updated to use embedded Controller
- `cli-ts/src/commands/task/send.ts` - Updated to use embedded Controller
- `cli-ts/src/commands/task/view.ts` - Updated to use embedded Controller

**Existing file to leverage:**
- `cli-ts/src/core/host-provider-setup.ts` - Already sets up HostProvider for CLI

**Options for task send:**
- `-a, --approve` - Approve proposed action
- `-d, --deny` - Deny proposed action
- `-f, --file <FILE>` - Attach file
- `-y, --no-interactive, --yolo` - Autonomous mode
- `-m, --mode <mode>` - Switch mode

**Options for task view:**
- `-f, --follow` - Stream updates in real-time
- `-c, --follow-complete` - Follow until completion

**Implementation Steps:**
1. Create `embedded-controller.ts` to initialize Controller using:
   - `initializeContext()` from `src/standalone/vscode-context.ts`
   - `setupHostProvider()` from `cli-ts/src/core/host-provider-setup.ts`
   - Direct Controller import from `src/core/controller/index.ts`

2. Create `cli-webview-adapter.ts` to handle state updates:
   - Listen to `controller.task?.messageStateHandler` events
   - Format ClineMessages for terminal output
   - Handle streaming partial messages

3. Update `chat.ts` to use embedded Controller:
   - Initialize Controller on command start
   - Send prompts via `controller.initTask(prompt)`
   - Receive messages via state handler events
   - Handle user input via `handleWebviewAskResponse()`

4. Update `send.ts` and `view.ts` similarly

**Tests:**
- Chat mode provides REPL interface with real Controller
- Messages stream to terminal in real-time
- Approve/deny call correct Controller methods
- State persists to ~/.cline/ and is readable by VSCode

---

### 3.4 Task Control
**Priority: Medium** | **Complexity: Medium**

**Commands:**
- `cline task restore <checkpoint>` / `cline t r`
- `cline task pause` / `cline t p`

**Files to create:**
- `cli-ts/src/commands/task/restore.ts`
- `cli-ts/src/commands/task/pause.ts`

**Tests:**
- Restore reverts to checkpoint
- Pause suspends execution

---

## Phase 4: Instant Task Mode

### 4.1 Instant Task Shorthand
**Priority: High** | **Complexity: Medium**

Implement `cline "prompt"` instant task mode that combines instance + task + chat.

**Modify:**
- `cli-ts/src/index.ts` - Detect prompt argument and route to instant task

**Options:**
- `-o, --oneshot` - Complete and stop
- `-s, --setting <key> <value>` - Override settings
- `-y, --no-interactive, --yolo` - Autonomous mode
- `-m, --mode <mode>` - Starting mode
- `-w, --workspace <path>` - Additional workspace paths (can repeat)

**Behavior:**
1. Get or spawn default instance
2. Create new task with prompt
3. Enter chat mode (or oneshot if -o)

**Tests:**
- Instant task spawns instance if needed
- Oneshot completes and exits
- Workspace paths are passed correctly

---

## Phase 5: Global Options Enhancement

### 5.1 Address Flag
**Priority: Medium** | **Complexity: Low**

Add `-a, --address <ADDR>` global option to specify which Cline Core instance to use.

**Modify:**
- `cli-ts/src/index.ts` - Add --address option
- All task commands to use address or default

---

### 5.2 Verbose Flag Enhancement
**Priority: Low** | **Complexity: Low**

Enhance `-v, --verbose` to show debug output including gRPC communication details.

---

## Implementation Order (Recommended)

### Sprint 1: Foundation (Completed)
1. [x] 1.1 Output Formatting System
2. [x] 1.2 Configuration System
3. [x] 2.1 Auth Command

### Sprint 2: Instance Management (Deprecated)
4. [x] 1.3 Instance Registry & Lifecycle (Deprecated, skipped)

### Sprint 3: Task Basics (Completed)
5. [x] 3.1 Task Command Group Base
6. [x] 3.2 Task Creation & History

### Sprint 4: Task Communication (✅ Complete)
7. [x] 3.3 Task Communication (chat, send, view) - Embedded Controller architecture implemented

### Sprint 5: Advanced Features
8. [ ] 4.1 Instant Task Mode
9. [ ] 3.4 Task Control
10. [ ] 5.1 Address Flag
11. [ ] 5.2 Verbose Flag Enhancement

---

## File Structure Summary

```
cli-ts/
├── src/
│   ├── index.ts                    # Main entry (enhanced)
│   ├── commands/
│   │   ├── version.ts              # ✓ Complete
│   │   ├── auth/
│   │   │   └── index.ts
│   │   ├── config/
│   │   │   ├── index.ts
│   │   │   ├── set.ts
│   │   │   ├── get.ts
│   │   │   └── list.ts
│   │   ├── instance/
│   │   │   ├── index.ts
│   │   │   ├── new.ts
│   │   │   ├── list.ts
│   │   │   ├── default.ts
│   │   │   └── kill.ts
│   │   └── task/
│   │       ├── index.ts
│   │       ├── new.ts
│   │       ├── list.ts
│   │       ├── open.ts
│   │       ├── chat.ts
│   │       ├── send.ts
│   │       ├── view.ts
│   │       ├── restore.ts
│   │       └── pause.ts
│   ├── core/
│   │   ├── config.ts               # ✓ Complete
│   │   ├── logger.ts               # ✓ Complete
│   │   ├── context.ts              # ✓ Complete
│   │   ├── host-provider-setup.ts  # ✓ Complete
│   │   ├── config-storage.ts       # NEW
│   │   ├── instance-registry.ts    # NEW
│   │   ├── instance-client.ts      # NEW
│   │   ├── task-client.ts          # NEW
│   │   ├── output/
│   │   │   ├── formatter.ts
│   │   │   ├── rich-formatter.ts
│   │   │   ├── json-formatter.ts
│   │   │   └── plain-formatter.ts
│   │   └── auth/
│   │       ├── providers.ts
│   │       ├── wizard.ts
│   │       └── oauth.ts
│   └── types/
│       ├── config.ts               # ✓ Complete
│       ├── logger.ts               # ✓ Complete
│       ├── task.ts                 # NEW
│       └── message.ts              # NEW (ClineMessage)
└── tests/
    └── unit/
        ├── commands/
        │   └── version.test.ts     # ✓ Complete
        ├── core/
        │   ├── config.test.ts      # ✓ Complete
        │   └── logger.test.ts      # ✓ Complete
        └── ... (new tests for each module)
```

---

## Next Steps

1. Start Sprint 3: Task Basics (Task Command Group Base + Task Creation & History)
2. Follow with Sprint 4: Task Communication (chat/send/view)
3. Finish with Sprint 5: Advanced Features (instant task mode, task control, address flag, verbose enhancement)

The plan is designed so each phase delivers working functionality that can be tested independently before moving to the next phase.

### New Task (Phase 3 Kickoff)
**Objective:** Implement Task Command Group Base and Task Creation & History.

**Planned files to create/modify:**
- `cli-ts/src/commands/task/index.ts`
- `cli-ts/src/core/task-client.ts`
- `cli-ts/src/types/task.ts`
- `cli-ts/src/commands/task/new.ts`
- `cli-ts/src/commands/task/list.ts`
- `cli-ts/src/commands/task/open.ts`
- Update `cli-ts/src/index.ts` to register the task command group

**Test requirements:**
- New task creates task in instance
- List shows task history with IDs and snippets
- Open resumes task with saved settings
