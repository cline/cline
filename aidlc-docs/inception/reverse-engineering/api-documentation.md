# API Documentation

## REST APIs
- No primary REST application surface was identified for the requested control-plane path. The inspected runtime mainly exposes ACP over stdio and gRPC services for standalone mode.

## Internal APIs
### `ClineAgent`
- **Location**: `cli/src/agent/ClineAgent.ts`
- **Methods**:
  - `initialize(params, connection?)`
  - `newSession(params)`
  - `prompt(params)`
  - `cancel(params)`
  - `setSessionMode(params)`
  - `unstable_setSessionModel(params)`
  - `authenticate(params)`
  - `shutdown()`
  - `emitterForSession(sessionId)`
- **Parameters**:
  - ACP request payloads for session, prompt, model, mode, and auth operations.
- **Return Types**:
  - ACP response objects or streamed updates through per-session emitters.

### `Controller`
- **Location**: `src/core/controller/index.ts`
- **Methods**:
  - `initTask(task, images, files, historyItem, taskSettings)`
  - `reinitExistingTaskFromId(taskId)`
  - `dispose()`
  - state and auth mutation helpers
- **Parameters**:
  - Prompt content, file and image mentions, history item for task resume, and settings overrides.
- **Return Types**:
  - Task IDs, side effects on task state, and posted state updates.

### ProtoBus service
- **Location**: `src/standalone/protobus-service.ts`
- **Methods**:
  - Controller-backed unary and streaming gRPC handlers registered by generated setup code.
- **Parameters**:
  - Generated protobuf request messages and optional metadata such as `request-id`.
- **Return Types**:
  - Unary responses or streamed controller outputs.

## Protocol Surfaces
### ACP session lifecycle
- **Entry Points**:
  - `cli/src/acp/index.ts`
  - `cli/src/acp/AcpAgent.ts`
- **Purpose**: Expose the CLI as a protocol-compliant agent over stdio or as an embeddable library.
- **Key Behaviors**:
  - Session creation and prompt submission
  - Permission forwarding
  - Streaming session updates

### Host bridge gRPC
- **Entry Points**:
  - `src/hosts/external/host-bridge-client-manager.ts`
  - `src/standalone/hostbridge-client.ts`
- **Purpose**: Access host workspace, env, window, and diff operations from the detached runtime.

## Data Models
### `ClineAcpSession`
- **Fields**: `sessionId`, `cwd`, `mode`, `mcpServers`, `createdAt`, `lastActivityAt`, optional model overrides and history flags
- **Relationships**: Linked to a `Controller`, session state entry, and emitter in `ClineAgent`
- **Validation**: Existence enforced before prompt, mode, or model operations

### `AcpSessionState`
- **Fields**: `sessionId`, `status`, `pendingToolCalls`, transient tool call tracking
- **Relationships**: Kept in `sessionStates` map and updated during prompt processing
- **Validation**: Prevents concurrent prompt processing on a single session

### `SessionStats`
- **Location**: `src/shared/services/Session.ts`
- **Fields**: tool call counts, timing, CPU and memory metrics, peak memory
- **Relationships**: Used by CLI summary and runtime reporting paths
- **Validation**: Derived from process-level metrics rather than persisted schemas
