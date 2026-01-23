# ACP Implementation Plan for Cline CLI

## Overview

Add an `--acp` flag to the Cline CLI that transforms it into an ACP-compliant agent. When enabled, the CLI will:
- Communicate via JSON-RPC over stdio (no React Ink UI)
- Implement the ACP `Agent` interface using `@agentclientprotocol/sdk`
- Delegate file system operations to the client
- Support task execution only (main use case)
- Support session persistence (loadSession restores from disk)
- Pass through MCP servers from the client

## Reference Implementation

Based on [claude-code-acp](https://github.com/zed-industries/claude-code-acp/blob/main/src/acp-agent.ts) by Zed Industries.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Editor (ACP Client)                       │
│  - Zed, JetBrains, etc.                                     │
│  - Spawns cline --acp as subprocess                         │
│  - Implements fs/read_text_file, fs/write_text_file         │
│  - Implements terminal/* methods                            │
│  - Handles session/request_permission                       │
└─────────────────────────────────────────────────────────────┘
                              │
                    stdio (JSON-RPC)
                              │
┌─────────────────────────────────────────────────────────────┐
│                    Cline CLI (ACP Agent)                    │
│  ┌────────────────────────────────────────────────────┐    │
│  │              AcpAgent (NEW)                         │    │
│  │  - Implements acp.Agent interface                   │    │
│  │  - Handles initialize, session/new, session/prompt  │    │
│  │  - Translates ClineMessages → session/update        │    │
│  └────────────────────────────────────────────────────┘    │
│                              │                              │
│  ┌────────────────────────────────────────────────────┐    │
│  │           AcpHostBridgeProvider (NEW)               │    │
│  │  - Replaces file operations with client delegation  │    │
│  │  - Wraps terminal operations via client             │    │
│  └────────────────────────────────────────────────────┘    │
│                              │                              │
│  ┌────────────────────────────────────────────────────┐    │
│  │              Existing Controller/Task               │    │
│  │  - Core agent logic (unchanged)                     │    │
│  └────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────┘
```

## File Structure

```
cli-ts/src/acp/
├── index.ts                  # Re-exports
├── runAcpMode.ts             # Entry point for ACP mode
├── AcpAgent.ts               # Main agent implementation (acp.Agent)
├── AcpHostBridgeProvider.ts  # File/terminal delegation to client
├── AcpTerminalManager.ts     # Terminal operations via client
├── messageTranslator.ts      # ClineMessage → ACP session/update
├── permissionHandler.ts      # Permission request handling
└── types.ts                  # Custom types/extensions
```

## Implementation Tasks

### Phase 1: Setup & Dependencies ✅
- [x] **1.1** Add `@agentclientprotocol/sdk` dependency to `cli-ts/package.json`
- [x] **1.2** Create `cli-ts/src/acp/` directory structure
- [x] **1.3** Create `cli-ts/src/acp/types.ts` with custom type extensions

### Phase 2: Core ACP Agent
- [x] **2.1** Create `cli-ts/src/acp/AcpAgent.ts` implementing `acp.Agent` interface
  - [x] `initialize()` - Return protocol version and capabilities
  - [x] `newSession()` - Create session, initialize Controller with cwd and MCP servers
  - [x] `loadSession()` - Restore session from disk using existing task history
  - [x] `prompt()` - Handle user prompts, translate to Controller.initTask or followup
  - [x] `cancel()` - Handle task cancellation via Controller.cancelTask
  - [x] `setSessionMode()` - Handle plan/act mode switching

### Phase 3: Message Translation ✅
- [x] **3.1** Create `cli-ts/src/acp/messageTranslator.ts`
  - [x] Map `say: "text"` → `agent_message_chunk`
  - [x] Map `say: "reasoning"` → `agent_thought_chunk`
  - [x] Map `say: "tool"` → `tool_call`
  - [x] Map `say: "command"` → `tool_call` (kind: "execute")
  - [x] Map `say: "command_output"` → `tool_call_update` with terminal content
  - [x] Map `say: "completion_result"` → stopReason: "end_turn"
  - [x] Map `say: "error"` → error response or tool_call_update (failed)
  - [x] Map `ask: *` → tool_call + session/request_permission
  - [x] Map focus chain/todos → `plan` update

### Phase 4: Permission Handling ✅
- [x] **4.1** Create `cli-ts/src/acp/permissionHandler.ts`
  - [x] Map Cline ask types to ACP permission options
  - [x] Handle permission responses (allow_once, allow_always, reject_once, reject_always)
  - [x] Translate responses back to Controller.task.handleWebviewAskResponse
  - [x] AutoApprovalTracker class for tracking "always allow" decisions

### Phase 5: Host Bridge (File/Terminal Delegation) ✅
- [x] **5.1** Create `cli-ts/src/acp/AcpHostBridgeProvider.ts`
  - [x] Implement file read delegation via `connection.readTextFile()`
  - [x] Implement file write delegation via `connection.writeTextFile()`
  - [x] Check client capabilities before delegating

- [x] **5.2** Create `cli-ts/src/acp/AcpTerminalManager.ts`
  - [x] Implement `createTerminal()` using client's `terminal/create`
  - [x] Implement output retrieval via `terminal/output`
  - [x] Implement `waitForExit()` via `terminal/wait_for_exit`
  - [x] Implement `release()` via `terminal/release`
  - [x] Implement `kill()` via `terminal/kill`

### Phase 6: Entry Point Integration
- [ ] **6.1** Create `cli-ts/src/acp/runAcpMode.ts`
  - [ ] Redirect console.log/info/warn/debug to stderr (stdout reserved for ACP)
  - [ ] Set up ndJsonStream with stdin/stdout
  - [ ] Create AgentSideConnection
  - [ ] Keep process alive with stdin.resume()

- [ ] **6.2** Modify `cli-ts/src/index.ts`
  - [ ] Add `--acp` flag to commander (root level)
  - [ ] When `--acp` is set, call `runAcpMode()` instead of normal flow
  - [ ] Skip React Ink rendering entirely in ACP mode

### Phase 7: State Synchronization
- [ ] **7.1** Implement state broadcasting in AcpAgent
  - [ ] Subscribe to Controller.postStateToWebview
  - [ ] Diff state changes and emit session/update notifications
  - [ ] Handle streaming/partial messages

### Phase 8: Session Persistence
- [ ] **8.1** Implement `loadSession()` in AcpAgent
  - [ ] Use existing StateManager.getGlobalStateKey("taskHistory")
  - [ ] Find session by ID in task history
  - [ ] Replay conversation via session/update notifications
  - [ ] Resume session using Controller.reinitExistingTaskFromId

### Phase 9: Testing & Polish
- [ ] **9.1** Add unit tests for message translation
- [ ] **9.2** Add integration tests with mock ACP client
- [ ] **9.3** Manual testing with Zed editor
- [ ] **9.4** Update CLI README with ACP documentation

---

## Key Mappings

### Cline Messages → ACP Session Updates

| Cline Message Type | ACP Session Update |
|-------------------|-------------------|
| `say: "text"` | `agent_message_chunk` (text) |
| `say: "reasoning"` | `agent_thought_chunk` |
| `say: "markdown"` | `agent_message_chunk` (text) |
| `say: "tool"` | `tool_call` |
| `say: "command"` | `tool_call` (kind: "execute") |
| `say: "command_output"` | `tool_call_update` with terminal content |
| `say: "completion_result"` | stopReason: "end_turn" |
| `say: "error"` | Error response or `tool_call_update` (failed) |
| `ask: "command"` | `tool_call` + `session/request_permission` |
| `ask: "tool"` | `tool_call` + `session/request_permission` |
| `ask: "followup"` | Return from `prompt()`, await next prompt |
| Focus chain/todos | `plan` update |

### ACP Capabilities to Advertise

```typescript
{
  protocolVersion: 1,
  agentCapabilities: {
    loadSession: true,  // Support resuming sessions from disk
    promptCapabilities: {
      image: true,      // Support image inputs
      audio: false,     // No audio support
      embeddedContext: true,  // Support file resources
    },
    mcpCapabilities: {
      http: true,       // Support HTTP MCP servers (passthrough)
      sse: true,        // Support SSE MCP servers (passthrough)
    },
  },
  agentInfo: {
    name: "cline",
    title: "Cline",
    version: CLI_VERSION,
  },
}
```

### Permission Options Mapping

| Cline Ask Type | ACP Permission Options |
|---------------|----------------------|
| `command` | Allow once, Allow always, Reject |
| `tool` | Allow once, Allow always, Reject |
| `browser_action_launch` | Allow once, Reject |
| `use_mcp_server` | Allow once, Allow always, Reject |

---

## Notes

- **Console redirection**: All console output must go to stderr; stdout is reserved for JSON-RPC
- **MCP passthrough**: Client-provided MCP servers are passed to Controller via mcpServers config
- **Session IDs**: Use task history IDs as session IDs for persistence
- **Error handling**: Use JSON-RPC 2.0 error codes per ACP spec
- **Authentication**: Deferred to future implementation

## Dependencies

- `@agentclientprotocol/sdk` - Official TypeScript SDK for ACP

---

## Relevant Local Files

### CLI Entry Point & Core
- `cli-ts/src/index.ts` - Main CLI entry point, commander setup, where `--acp` flag will be added
- `cli-ts/package.json` - Dependencies, where `@agentclientprotocol/sdk` will be added

### Controllers & Providers
- `cli-ts/src/controllers/index.ts` - Creates CLI host bridge provider
- `cli-ts/src/controllers/CliWebviewProvider.ts` - CLI-specific webview provider
- `cli-ts/src/controllers/CliCommentReviewController.ts` - Comment review controller

### Context & State
- `cli-ts/src/context/TaskContext.tsx` - React context for task state, subscribes to Controller updates
- `cli-ts/src/context/StdinContext.tsx` - Stdin handling context

### UI Components (for understanding message flow, not used in ACP mode)
- `cli-ts/src/components/App.tsx` - Main app router
- `cli-ts/src/components/TaskView.tsx` - Task execution view
- `cli-ts/src/components/AskPrompt.tsx` - User input/permission handling
- `cli-ts/src/components/MessageList.tsx` - Message rendering
- `cli-ts/src/components/MessageRow.tsx` - Individual message rendering

### Utilities
- `cli-ts/src/utils/piped.ts` - Stdin piped input reading
- `cli-ts/src/utils/console.ts` - Console utilities
- `cli-ts/src/utils/display.ts` - Display/print utilities
- `cli-ts/src/utils/parser.ts` - Input parsing utilities

### Core (src/core/) - Referenced but not modified
- `src/core/controller/index.ts` - Main Controller class
- `src/core/storage/StateManager.ts` - State persistence, task history
- `src/core/webview/index.ts` - WebviewProvider base class

### Shared Types
- `src/shared/ExtensionMessage.ts` - ClineMessage, ExtensionState types
- `src/shared/proto-conversions/cline-message.ts` - Proto message conversions

### Hooks (for state subscription pattern)
- `cli-ts/src/hooks/useStateSubscriber.ts` - State subscription hooks

### VSCode Shims
- `cli-ts/src/vscode-shim.ts` - VSCode API shims for CLI
- `cli-ts/src/vscode-context.ts` - Extension context initialization
