# CLI Features Implementation Plan

Based on the cline.1.md man page, this document outlines the implementation plan for all CLI features. The Cline man page indicates that cline cli runs as a client-server architecture where **Cline Core** runs as a standalone service, but for the typescript version of the CLI, that won't be the case. The Typescript CLI will just import the necessary objects it needs from cline core src directly.

## Overview

The TypeScript CLI scaffold is complete. This plan covers implementing the full feature set from the man page, prioritized by dependency order and user value.

---

## Phase 1: Core Infrastructure (Prerequisites)

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

### 3.1 Task Command Group Base
**Priority: High** | **Complexity: Medium**

Implement the task command infrastructure.

**Files to create:**
- `cli-ts/src/commands/task/index.ts` - Task command group
- `cli-ts/src/core/task-client.ts` - Task gRPC client wrapper
- `cli-ts/src/types/task.ts` - Task-related types

**Commands:**
- `cline task` / `cline t` - Display help

---

### 3.2 Task Creation & History
**Priority: High** | **Complexity: Medium**

**Commands:**
- `cline task new <prompt> [options]` / `cline t n`
- `cline task list` / `cline t l`
- `cline task open <task-id>` / `cline t o`

**Files to create:**
- `cli-ts/src/commands/task/new.ts`
- `cli-ts/src/commands/task/list.ts`
- `cli-ts/src/commands/task/open.ts`

**Options for task new/open:**
- `-s, --setting <key> <value>` - Override settings
- `-y, --no-interactive, --yolo` - Autonomous mode
- `-m, --mode <mode>` - Starting mode (act/plan)

**Tests:**
- New task creates task in instance
- List shows task history with IDs and snippets
- Open resumes task with saved settings

---

### 3.3 Task Communication
**Priority: High** | **Complexity: High**

**Commands:**
- `cline task chat` / `cline t c` - Interactive chat mode
- `cline task send [message] [options]` / `cline t s`
- `cline task view [--follow] [--follow-complete]` / `cline t v`

**Files to create:**
- `cli-ts/src/commands/task/chat.ts` - Interactive REPL mode
- `cli-ts/src/commands/task/send.ts` - Send single message
- `cli-ts/src/commands/task/view.ts` - View/stream conversation

**Options for task send:**
- `-a, --approve` - Approve proposed action
- `-d, --deny` - Deny proposed action
- `-f, --file <FILE>` - Attach file
- `-y, --no-interactive, --yolo` - Autonomous mode
- `-m, --mode <mode>` - Switch mode

**Options for task view:**
- `-f, --follow` - Stream updates in real-time
- `-c, --follow-complete` - Follow until completion

**Tests:**
- Chat mode provides REPL interface
- Send supports stdin input
- View streams messages with follow flag
- Approve/deny work correctly

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

### Sprint 1: Foundation (1-2 weeks)
1. [ ] 1.1 Output Formatting System
2. [ ] 1.2 Configuration System
3. [ ] 2.1 Auth Command

### Sprint 2: Instance Management (1-2 weeks)
4. [ ] 1.3 Instance Registry & Lifecycle (Deprecated, do Not implement)

### Sprint 3: Task Basics (1-2 weeks)
5. [ ] 3.1 Task Command Group Base
6. [ ] 3.2 Task Creation & History

### Sprint 4: Task Communication (2 weeks)
7. [ ] 3.3 Task Communication (chat, send, view)

### Sprint 5: Advanced Features (1-2 weeks)
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

1. Review and approve this plan
2. Start with Sprint 1: Output Formatting System
3. Iterate through each phase with tests

The plan is designed so each phase delivers working functionality that can be tested independently before moving to the next phase.
