# Cline CLI Architecture

The CLI is a **standalone terminal interface** for the Cline AI coding assistant, written in Go. It provides the same autonomous coding capabilities as the VS Code extension but runs entirely in the terminal.

## High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           User Terminal                                 │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                         cline (Go binary)                               │
│                         cmd/cline/main.go                               │
│   • Cobra CLI commands (task, auth, config, instance, etc.)             │
│   • Interactive input via Bubble Tea                                    │
│   • Streaming output with markdown rendering                            │
└─────────────────────────────────────────────────────────────────────────┘
          │ gRPC (50052)                                │ starts subprocess
          ▼                                             ▼
┌─────────────────────────┐                  ┌─────────────────────────┐
│      cline-core         │◄────────────────►│      cline-host         │
│      (Node.js)          │   gRPC (51052)   │      (Go binary)        │
│                         │                  │   cmd/cline-host/main.go│
│  • AI/LLM orchestration │                  │                         │
│  • Tool execution       │                  │  • Workspace paths      │
│  • Task state mgmt      │                  │  • File diff editing    │
│  • Message handling     │                  │  • Clipboard access     │
└─────────────────────────┘                  │  • Environment info     │
          │                                  └─────────────────────────┘
          │ SQLite (self-registration)
          ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                   ~/.cline/data/locks/locks.db                          │
│            (Instance registry - core self-registers on startup)         │
└─────────────────────────────────────────────────────────────────────────┘
```

## Entry Points (`cmd/`)

### `cmd/cline/main.go` - Main CLI

Cobra-based CLI with commands:

- **Root**: `cline [prompt]` - Start a task directly
- **task**: Create, send, view, list, pause, restore tasks
- **auth**: Authentication setup and provider configuration
- **config**: Read/write settings
- **instance**: Manage running Cline instances
- **logs**: View and clean log files
- **doctor**: System health check

### `cmd/cline-host/main.go` - Host Bridge Service

Separate gRPC server providing host environment operations to cline-core:

- Workspace paths
- File diff editing
- Clipboard access
- Shutdown coordination

---

## `pkg/cli/` Subsystems

### 1. `auth/` - Authentication System

Handles authentication with Cline service and BYO (Bring Your Own) API providers.

| File                      | Purpose                                                                  |
| ------------------------- | ------------------------------------------------------------------------ |
| `auth_cline_provider.go`  | OAuth login flow - opens browser, subscribes to auth callback stream     |
| `auth_menu.go`            | Interactive menu showing auth options based on current state             |
| `auth_subscription.go`    | gRPC stream subscription for auth status updates                         |
| `wizard_byo.go`           | Interactive wizard for configuring BYO providers                         |
| `wizard_byo_bedrock.go`   | AWS Bedrock-specific credential setup                                    |
| `wizard_byo_oca.go`       | Oracle Code Assist setup                                                 |
| `providers_list.go`       | Retrieves configured providers from core state                           |
| `providers_byo.go`        | Provider selection UI and field configuration                            |
| `models_*.go`             | Model listing (static lists + dynamic fetch from OpenRouter/OpenAI/Ollama) |

**Flow**: User runs `cline auth` → Menu shows options → For BYO: wizard guides through provider/key/model selection → Config saved via gRPC to core.

---

### 2. `clerror/` - Error Handling

Parses and classifies API errors from the Cline service.

**Error Types:**

- `ErrorTypeAuth` - 401, bad API key
- `ErrorTypeBalance` - Insufficient credits
- `ErrorTypeRateLimit` - 429, quota exceeded
- `ErrorTypeNetwork` - Connection issues
- `ErrorTypeUnknown` - Catch-all

Extracts billing details (balance, spent, buy credits URL) from error responses.

---

### 3. `config/` - Configuration Management

| File                  | Purpose                                                                    |
| --------------------- | -------------------------------------------------------------------------- |
| `manager.go`          | gRPC interface for reading/writing settings via `UpdateSettingsCli` RPC    |
| `settings_renderer.go`| Pretty-prints config values, censors sensitive fields (keys, secrets)      |

Supports dot-notation paths: `cline config get auto-approval-settings.actions.read-files`

---

### 4. `display/` - Terminal Display System

The most complex subsystem - handles all visual output.

| File                    | Purpose                                                              |
| ----------------------- | -------------------------------------------------------------------- |
| `renderer.go`           | Central coordinator with lipgloss styles, color methods, markdown delegation |
| `streaming.go`          | Real-time streaming display with deduplication                       |
| `segment_streamer.go`   | Streaming segments (header + body) with context-aware headers        |
| `typewriter.go`         | Character-by-character animation with variable delays                |
| `markdown_renderer.go`  | Glamour wrapper for terminal markdown rendering                      |
| `tool_renderer.go`      | Tool operation formatting ("Cline is editing `file.ts`")             |
| `tool_result_parser.go` | Parses structured tool results (file lists, search results)          |
| `banner.go`             | Session startup banner with version/model/workspace                  |
| `deduplicator.go`       | MD5-based deduplication with 2-second window                         |
| `system_renderer.go`    | Rich error/warning boxes for balance errors, auth failures           |
| `ansi.go`               | TTY detection, line clearing with escape codes                       |

---

### 5. `global/` - Global State Management

| File               | Purpose                                                                    |
| ------------------ | -------------------------------------------------------------------------- |
| `global.go`        | Global config (paths, verbosity, output format), initialization            |
| `registry.go`      | Instance discovery via SQLite, health checking, default instance management|
| `cline-clients.go` | Starts cline-core + cline-host processes, port allocation, cleanup         |

**Instance lifecycle:**

1. Find available port pair
2. Start `cline-host` on port+1000
3. Start `cline-core` on port
4. Wait for core to self-register in SQLite
5. Set as default if first instance

---

### 6. `handlers/` - Message Handlers

Routes incoming messages from cline-core to appropriate renderers.

| File               | Purpose                                                               |
| ------------------ | --------------------------------------------------------------------- |
| `handler.go`       | Handler registry with priority-based routing                          |
| `ask_handlers.go`  | Approval requests: tool, command, followup, api_req_failed, etc.      |
| `say_handlers.go`  | Status messages: text, reasoning, command_output, tool, checkpoint, etc. |

Uses `DisplayContext` providing renderer access, state, and context flags (isLast, isPartial, isStreamingMode).

---

### 7. `output/` - Output Coordination

| File                  | Purpose                                                                 |
| --------------------- | ----------------------------------------------------------------------- |
| `coordinator.go`      | Coordinates streaming output with interactive input (saves/restores input state) |
| `input_model.go`      | Bubble Tea model for rich input (message, approval, feedback types)     |
| `slash_completion.go` | Autocomplete dropdown for slash commands                                |

**Key pattern:** When output needs to print while input is visible, the coordinator saves input state, clears the form, prints, then restores input.

---

### 8. `slash/` - Slash Command Registry

Central registry for commands like `/plan`, `/act`, `/cancel`:

- **CLI-local commands**: Handled directly by CLI
- **Backend commands**: Fetched from core via gRPC, filtered by `CliCompatible` flag

---

### 9. `sqlite/` - Instance Locking

Manages the distributed locking system:

- **Instance locks**: Track running Cline instances by address
- **File locks**: Coordinate file access across instances
- SQLite database created by cline-core, CLI reads/writes for discovery

---

### 10. `task/` - Task Management

| File                    | Purpose                                                              |
| ----------------------- | -------------------------------------------------------------------- |
| `manager.go`            | Core orchestrator: create, cancel, resume, restore tasks; stream handling |
| `stream_coordinator.go` | Deduplication and turn management for dual streams                   |
| `input_handler.go`      | Interactive input during follow mode (polling, approval detection)   |
| `history_handler.go`    | Direct disk access to `taskHistory.json`                             |
| `settings_parser.go`    | Parse settings from CLI flags                                        |
| `follow_options.go`     | Configuration for follow behavior                                    |

**Streaming:** Task manager subscribes to two gRPC streams:

1. `SubscribeToState` - Full state updates
2. `SubscribeToPartialMessage` - Streaming AI responses

---

### 11. `terminal/` - Terminal Handling

Enhanced keyboard protocol support and terminal configuration:

- Enables modifyOtherKeys and Kitty keyboard protocol
- Detects terminal type (VS Code, iTerm, Ghostty, Kitty, etc.)
- Auto-configures shift+enter keybindings for various terminals

---

### 12. `types/` - Type Definitions

| File           | Purpose                                                           |
| -------------- | ----------------------------------------------------------------- |
| `messages.go`  | `ClineMessage`, `AskType`, `SayType`, `ToolType` enums, proto conversion |
| `state.go`     | `ConversationState` with thread-safe message access               |
| `history.go`   | `HistoryItem` matching taskHistory.json format                    |

---

### 13. `updater/` - Auto-Update

Background auto-update checking:

- 24-hour check interval (cached)
- Queries npm registry for newer versions
- Supports `latest` and `nightly` channels
- Runs `npm install -g cline` to update

---

## `pkg/common/` - Shared Types

| File            | Purpose                                                      |
| --------------- | ------------------------------------------------------------ |
| `constants.go`  | `SETTINGS_SUBFOLDER`, `DEFAULT_CLINE_CORE_PORT`              |
| `schema.go`     | SQL queries for instance/file locks                          |
| `types.go`      | `CoreInstanceInfo`, `LockRow`, `DefaultCoreInstance`         |
| `utils.go`      | Port checking, health checks, address normalization, retry logic |

---

## `pkg/generated/` - Auto-Generated

| File                  | Purpose                                                                                                              |
| --------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `providers.go`        | Provider definitions (Anthropic, OpenAI, Bedrock, etc.) with field metadata and model specs - generated from TypeScript sources |
| `field_overrides.go`  | Manual overrides for field filtering                                                                                 |

---

## `pkg/hostbridge/` - CLI-to-Core Bridge

This is the **reverse bridge** allowing cline-core to request host environment operations:

| File                    | Purpose                                              |
| ----------------------- | ---------------------------------------------------- |
| `grpc_server.go`        | Main server registering all services                 |
| `simple_workspace.go`   | Workspace service: returns CWD as workspace path     |
| `diff.go`               | In-memory file diff editing with line-based operations |
| `env.go`                | Clipboard access, version info, shutdown coordination |
| `window.go`             | UI stubs (no-ops or console output)                  |

**Why this exists:** The same cline-core logic runs in VS Code and CLI. In VS Code, the "host" is the extension with editor APIs. In CLI, hostbridge emulates these capabilities with terminal-appropriate implementations.

---

## Key Design Decisions

1. **Two-process model:** `cline` CLI manages instances; `cline-core` is the actual AI engine (Node.js). This allows reusing the same core as the VS Code extension.

2. **Self-registration via SQLite:** `cline-core` registers itself in a SQLite database on startup. The CLI discovers instances by reading this database, enabling multi-instance support.

3. **Host bridge abstraction:** The `cline-host` process provides platform-specific operations (clipboard, workspace paths) via gRPC, allowing `cline-core` to remain host-agnostic.

4. **Streaming-first UI:** The CLI uses gRPC streaming to display AI responses in real-time with typewriter-style rendering.

5. **Dual stream handling:** Task manager subscribes to both state updates and partial messages, using deduplication to prevent duplicate rendering.
