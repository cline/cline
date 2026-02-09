# Proto Schema Guide

Complete reference for proto file structure and conventions in Cline.

## Proto File Organization

```
proto/cline/
├── common.proto    # Shared simple types (Empty, StringRequest, etc.)
├── task.proto      # Task operations, bead RPCs
├── ui.proto        # UI messages (ClineAsk, ClineSay enums)
├── models.proto    # Data models (ApiConfiguration, ModelInfo, etc.)
├── account.proto   # Authentication, subscriptions
└── state.proto     # Auto-generated from state-keys.ts
```

## common.proto - Shared Types

Use these instead of creating new simple wrapper types:

```protobuf
syntax = "proto3";
package cline;

// Use for RPCs that return nothing
message Empty {}

// Use for RPCs that take a single string
message StringRequest {
  string value = 1;
}

// Use for RPCs that return a single string
message StringResponse {
  string value = 1;
}

// Use for RPCs that take a single int64
message Int64Request {
  int64 value = 1;
}

// Use for RPCs that return a single bool
message BoolResponse {
  bool value = 1;
}
```

## ui.proto - UI Enums

### ClineAsk Enum

Values the extension sends to ask the user a question:

```protobuf
enum ClineAsk {
  CLINEASK_UNSPECIFIED = 0;
  FOLLOWUP = 1;                    // Ask follow-up question
  TOOL = 2;                        // Tool approval
  COMMAND = 3;                     // Command approval
  COMPLETION_RESULT = 4;           // Task completion
  API_REQ_FAILED = 5;              // API error
  RESUME_TASK = 6;                 // Resume after cancel
  RESUME_COMPLETED_TASK = 7;       // Resume completed task
  MISTAKE_LIMIT_REACHED = 8;       // Too many mistakes
  AUTO_APPROVAL_MAX_REQ_REACHED = 9;
  BROWSER_ACTION_LAUNCH = 10;
  USE_MCP_SERVER = 11;
  COMMAND_PERMISSION = 12;
  TOOL_FEEDBACK = 13;
  // Reserve 14-29 for future use
  // Add new values starting at 30
}
```

### ClineSay Enum

Values the extension sends to display information:

```protobuf
enum ClineSay {
  CLINESAY_UNSPECIFIED = 0;
  TEXT = 1;                        // Plain text
  TOOL = 2;                        // Tool being used
  ERROR = 3;                       // Error message
  COMPLETION_RESULT = 4;           // Completion summary
  API_REQ_STARTED = 5;             // API call started
  API_REQ_FINISHED = 6;            // API call finished
  USER_FEEDBACK = 7;               // User's feedback
  USER_FEEDBACK_DIFF = 8;          // User's diff feedback
  SHELL_INTEGRATION_WARNING = 9;
  BROWSER_ACTION = 10;
  BROWSER_ACTION_RESULT = 11;
  CHECKPOINT_SAVED = 12;
  COMMAND_OUTPUT = 13;
  MCP_SERVER_REQUEST_STARTED = 14;
  MCP_SERVER_RESPONSE = 15;
  REASONING = 16;                  // Model's reasoning
  CLINEMESSAGE_MIGRATION_INFO = 17;
  LOAD_MCP_DOCUMENTATION = 18;
  // Reserve 19-28 for future use
  GENERATE_EXPLANATION = 29;       // Generate changes explanation
  // Add new values starting at 30
}
```

## task.proto - Task Operations

### Service Definition

```protobuf
service TaskService {
  // Task lifecycle
  rpc StartNewTask(StartTaskRequest) returns (TaskResponse);
  rpc CancelTask(TaskIdRequest) returns (Empty);
  rpc ResumeTask(ResumeTaskRequest) returns (Empty);

  // Tool approval
  rpc ApproveToolUse(ToolApprovalRequest) returns (Empty);
  rpc RejectToolUse(ToolRejectionRequest) returns (Empty);

  // User interaction
  rpc SendFollowUp(FollowUpRequest) returns (Empty);
  rpc SubmitFeedback(FeedbackRequest) returns (Empty);

  // Streaming (use for long operations)
  rpc SubscribeToTaskUpdates(TaskIdRequest) returns (stream TaskUpdate);

  // Bead operations (Cline+)
  rpc ApproveBead(BeadApprovalRequest) returns (Empty);
  rpc RejectBead(BeadRejectionRequest) returns (Empty);
  rpc GetBeadStatus(TaskIdRequest) returns (BeadStatusResponse);
}
```

### Message Definitions

```protobuf
message StartTaskRequest {
  string prompt = 1;
  repeated string images = 2;
  optional string workspace_path = 3;
}

message TaskResponse {
  string task_id = 1;
  TaskStatus status = 2;
}

message TaskUpdate {
  oneof update {
    BeadStarted bead_started = 1;
    BeadCompleted bead_completed = 2;
    ToolUseRequested tool_use_requested = 3;
    ErrorOccurred error = 4;
  }
}

// Bead-specific messages
message BeadApprovalRequest {
  string task_id = 1;
  int32 bead_number = 2;
  optional string feedback = 3;
}

message BeadStatusResponse {
  int32 current_bead = 1;
  BeadStatus status = 2;
  repeated BeadSummary completed_beads = 3;
}
```

## models.proto - Data Models

### ApiProvider Enum

```protobuf
enum ApiProvider {
  APIPROVIDER_UNSPECIFIED = 0;
  ANTHROPIC = 1;
  OPENAI = 2;
  OPENAI_NATIVE = 3;
  AZURE = 4;
  VERTEX = 5;
  BEDROCK = 6;
  GLAMA = 7;
  GEMINI = 8;
  DEEPSEEK = 9;
  OLLAMA = 10;
  LMSTUDIO = 11;
  OPENROUTER = 12;
  LITELLM = 13;
  XAI = 14;
  SAMBANOVA = 15;
  CEREBRAS = 16;
  MISTRAL = 17;
  VSCODE_LM = 18;
  CLINE = 19;
  HUMAN_RELAY = 20;
  FAKE_AI = 21;
  // Reserve 22-39 for future use
  OPENAI_CODEX = 40;
  // Add new providers starting at 41
}
```

### ApiConfiguration Message

```protobuf
message ApiConfiguration {
  ApiProvider api_provider = 1;
  string api_model_id = 2;
  optional string api_key = 3;
  optional string base_url = 4;
  optional ModelInfo model_info = 5;

  // Provider-specific fields
  optional string azure_deployment = 6;
  optional string vertex_project = 7;
  optional string vertex_region = 8;
  optional string bedrock_region = 9;
  // ... more fields as needed
}

message ModelInfo {
  int32 max_tokens = 1;
  int32 context_window = 2;
  bool supports_images = 3;
  bool supports_computer_use = 4;
  optional double input_price = 5;
  optional double output_price = 6;
}
```

## state.proto - Auto-Generated

This file is **generated from `src/shared/storage/state-keys.ts`**. Do not edit directly.

```typescript
// state-keys.ts drives the generation
export interface Settings {
  apiProvider?: ApiProvider;
  apiModelId?: string;
  customInstructions?: string;
  alwaysAllowReadOnly?: boolean;
  // ... more settings
}

export interface GlobalState {
  lastShownAnnouncementId?: string;
  customModeHistory?: string[];
  // ... more state
}
```

After modifying `state-keys.ts`, run `npm run protos` to regenerate `state.proto`.

## Naming Conventions

| Element | Convention | Example |
|---------|------------|---------|
| Package | lowercase | `package cline;` |
| Service | PascalCase + "Service" | `TaskService` |
| RPC methods | camelCase | `startNewTask` |
| Messages | PascalCase | `TaskResponse` |
| Enums | PascalCase | `BeadStatus` |
| Enum values | SCREAMING_SNAKE | `AWAITING_APPROVAL` |
| Fields | snake_case | `task_id` |

## Field Number Allocation

- **1-15**: Frequently used fields (1 byte encoding)
- **16-2047**: Less frequent fields (2 byte encoding)
- **Reserved ranges**: Use for deprecated fields to prevent reuse

```protobuf
message Task {
  reserved 4, 7;                    // Previously used, don't reuse
  reserved "old_field_name";        // Document why reserved

  string id = 1;                    // Hot field, 1 byte
  string name = 2;                  // Hot field, 1 byte
  TaskStatus status = 3;            // Hot field, 1 byte
  // 4 reserved
  int64 created_at = 5;
  // ...
  string rarely_used = 100;         // Cold field, OK to be higher
}
```

## Streaming Patterns

For operations that take time and need progress updates:

```protobuf
service TaskService {
  // Client streams request, server returns single response
  rpc UploadFiles(stream FileChunk) returns (UploadResponse);

  // Server streams responses
  rpc SubscribeToUpdates(SubscribeRequest) returns (stream Update);

  // Bidirectional streaming (rare)
  rpc Chat(stream ChatMessage) returns (stream ChatResponse);
}
```

Example: Authentication callback (see `account.proto`):

```protobuf
service AccountService {
  rpc SubscribeToAuthCallback(Empty) returns (stream AuthStatus);
}

message AuthStatus {
  bool authenticated = 1;
  optional string token = 2;
  optional string error = 3;
}
```

## Adding New Proto File

1. Create `proto/cline/newdomain.proto`:
```protobuf
syntax = "proto3";
package cline;

option java_multiple_files = true;
option java_package = "com.cline.proto";

import "cline/common.proto";

service NewDomainService {
  rpc MyMethod(MyRequest) returns (MyResponse);
}

message MyRequest {
  string field = 1;
}

message MyResponse {
  bool success = 1;
}
```

2. Update `proto/buf.yaml` if using buf, or add to `tsconfig.json` paths

3. Run `npm run protos`

4. Create handler in `src/core/controller/newdomain/`

5. Wire up in controller initialization
