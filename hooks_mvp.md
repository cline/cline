---
title: "Hooks System MVP - Phase 1"
description: "Technical specification for Phase 1 hooks implementation with protobuf-based interfaces"
date: 2025-09-09
draft: false
---

# Hooks System MVP - Phase 1

This page documents the minimum viable product (MVP) implementation for Cline's hooks system, focusing on the seven Phase 1 hooks identified by client requirements. Each hook provides standardized input/output interfaces using protobuf-based data structures for consistency with Cline's existing gRPC architecture.

## Phase 1 Hook Overview

The MVP focuses on essential lifecycle and tool execution hooks that provide the highest value for automation and integration workflows:

| Hook Name | Category | Trigger Point | Implementation Hours |
|-----------|----------|---------------|---------------------|
| `PreToolUse` | Tool Execution | Before any tool execution | 8-12 hours |
| `PostToolUse` | Tool Execution | After successful tool execution | 6-10 hours |
| `UserPromptSubmit` | User Interaction | When user submits a message | 4-6 hours |
| `TaskStart` | Task Lifecycle | When a new task begins | 6-8 hours |
| `TaskResume` | Task Lifecycle | When resuming an existing task | 8-10 hours |
| `TaskCancel` | Task Lifecycle | User cancels task | 4-6 hours |
| `TaskComplete` | Task Lifecycle | When attempt_completion succeeds | 4-6 hours |
| `PreCompact` | System Events | Before context compaction | 10-14 hours |

**Total estimated effort: 46-66 hours**

## Addressing Amazon's Requirements:

| Req | Judgement |
|--|--|
| Hooks that inject context should support blocking/synchronous behavior with timeouts | all hooks blocking & timeout should be implemented by hook |
| Hooks that do not inject context can run Asynchronously | up to hook: start a background process & return no changes to context |
| Hook failures should be communicated clearly to the user and logged | supported: error field in hook return |
| Hooks should support both parallel and sequential execution to minimize latency | sequential only, single hook entrypoint only, up to implementers |
| Hooks should support both synchronous and asynchronous execution | up to hook: start a background process & return no changes to context |
| Hooks should support a timeout in order to not block the agent if failing | up to hook implementation |
| Configuration should be simple and flexible | same as git hooks |
| Hooks should have access to relevant context about the triggering event | included in spec |
| Context retention should be configurable - some hooks need persistent context, others should avoid consuming context window | we support persistent context only, use a subagent (cline-cli) in hook |
| Hook actions should be instrumented, and observable to see exactly what hooks are doing to help debug / iterate. | up to hook implementation |

| Req | Judgement |
|--|--|
| Configuration Format | Git hooks style instead of claude style |
| Context scope | Support global hooks in `~/.cline` and folder level hooks at `MyRepo/.clinerules` |
| Multiple hooks | Single entry point executable, manage multiple hooks however you want |
| Async vs sync | We only support sync & permanent context |
| Error handling | We support returning errors from hooks |
| Telemetry | Up to hook implementation |
| Toggling hooks | like git hooks, use `chmod` to change executable bit |

## Data Structures


### Hook Directory Structure

Implemented the same way as git hooks: a single entry point that can be any executable. Toggling hooks is done via `chmod +x` or `-x`

```
.clinerules/ (or .cline)
├── hooks/
│   ├── TaskStart*
│   ├── TaskComplete*
│   ├── PreFileWrite*
│   ├── PostFileWrite*
│   └── ...
└── logs/
    ├── TaskStart.log
    └── ...
```

All hooks use protobuf-based data structures converted to JSON for consistency with Cline's gRPC architecture:

### Base Hook Input
```protobuf
message HookInput {
  string hook_name = 1;
  string timestamp = 2;
  string task_id = 3;
  repeated string workspace_roots = 4;
  string user_id = 5;
  oneof data {
    PreToolUseData pre_tool_use = 10;
    PostToolUseData post_tool_use = 11;
    UserPromptSubmitData user_prompt_submit = 12;
    TaskStartData task_start = 13;
    TaskResumeData task_resume = 14;
    TaskCancelData task_complete = 15;
    TaskCompleteData task_complete = 16;
    PreCompactData pre_compact = 17;
  }
}
```

### Base Hook Output
```protobuf
message HookOutput {
  string context_modification = 1;
  bool should_continue = 2;
  string error_message = 3;
}
```

## Hook Specifications

### PreToolUse Hook

**Trigger:** Before any tool execution
**Purpose:** Validation, permission checks, parameter modification

**Input Data:**
```protobuf
message PreToolUseData {
  string tool_name = 1;
  map<string, string> parameters = 2;
}
```

**Use Cases:**
- Validate tool parameters before execution
- Implement custom permission checks
- Log tool usage for audit trails
- Modify parameters based on workspace context
- Block dangerous operations in production environments

**Implementation Notes:**
- Hook can prevent tool execution by setting `should_continue = false`
- Context modifications can add warnings or guidance to the AI
- Parameter validation should be comprehensive but fast

---

### PostToolUse Hook

**Trigger:** After successful tool execution
**Purpose:** Logging, backup creation, result processing

**Input Data:**
```protobuf
message PostToolUseData {
  string tool_name = 1;
  map<string, string> parameters = 2;
  string result = 3;
  bool success = 4;
  int64 execution_time_ms = 5;
}
```

**Use Cases:**
- Create automatic backups after file modifications
- Log successful operations for debugging
- Trigger downstream automation workflows
- Update external systems with operation results
- Generate metrics and performance data

**Implementation Notes:**
- Hook receives full tool execution context
- Can add context about operation success/failure
- Should handle errors gracefully to avoid breaking workflows

---

### UserPromptSubmit Hook

**Trigger:** When user submits a message
**Purpose:** Input validation, preprocessing, context enhancement

**Input Data:**
```protobuf
message UserPromptSubmitData {
  string prompt = 1;
  repeated string attachments = 2;
}
```

**Use Cases:**
- Validate user input for security concerns
- Preprocess prompts to add context or formatting
- Log user interactions for analysis
- Implement custom prompt templates
- Add workspace-specific context automatically

**Implementation Notes:**
- Can modify user prompt before AI processing
- Should preserve user intent while enhancing context
- Fast execution critical for user experience

---

### TaskStart Hook

**Trigger:** When a new task begins
**Purpose:** Initialize logging, setup workspace, prepare environment

**Input Data:**
```protobuf
message TaskStartData {
  map<string, string> task_metadata = 1;
}
```

**Use Cases:**
- Initialize task-specific logging systems
- Set up workspace environment variables
- Create task directories and scaffolding
- Notify external systems of new task
- Load task-specific configuration

**Implementation Notes:**
- First hook called in task lifecycle
- Can set up persistent context for entire task
- Should handle workspace initialization robustly

---

### TaskResume Hook

**Trigger:** When resuming an existing task
**Purpose:** Restore context, validate state, prepare for continuation

**Input Data:**
```protobuf
message TaskResumeData {
  map<string, string> task_metadata = 1;
  map<string, string> previous_state = 2;
}
```

**Use Cases:**
- Restore workspace state from previous session
- Validate that environment is ready for continuation
- Load cached data or intermediate results
- Notify team members of task resumption
- Reconcile changes made outside of Cline

**Implementation Notes:**
- More complex than TaskStart due to state restoration
- Should validate workspace consistency
- Can provide context about what changed since last session

---

### TaskCancel Hook

**Trigger:** When user cancels the task manually
**Purpose:** Cleanup, notifications, metrics collection

**Input Data:**
```protobuf
message TaskCancelData {
  map<string, string> task_metadata = 1;
}
```

**Use Cases:**
- Clean up temporary files and resources
- Send completion notifications to stakeholders
- Generate task completion reports
- Update project management systems
- Archive task artifacts

**Implementation Notes:**
- Final hook in successful task lifecycle
- Should handle cleanup even if other operations fail
- Can provide summary context about task completion

---

### TaskComplete Hook

**Trigger:** When attempt_completion succeeds
**Purpose:** Cleanup, notifications, metrics collection

**Input Data:**
```protobuf
message TaskCompleteData {
  map<string, string> task_metadata = 1;
}
```

**Use Cases:**
- Clean up temporary files and resources
- Send completion notifications to stakeholders
- Generate task completion reports
- Update project management systems
- Archive task artifacts

**Implementation Notes:**
- Final hook in successful task lifecycle
- Should handle cleanup even if other operations fail
- Can provide summary context about task completion

---

### PreCompact Hook

**Trigger:** Before context compaction occurs
**Purpose:** Archive conversation history, preserve important context

**Input Data:**
```protobuf
message PreCompactData {
  int64 context_size = 1;
  int32 messages_to_compact = 2;
  string compaction_strategy = 3;
}
```

**Use Cases:**
- Archive full conversation history before compaction
- Extract and preserve critical information
- Generate summaries of compacted content
- Update external knowledge bases
- Implement custom compaction strategies

**Implementation Notes:**
- Most complex hook due to context management requirements
- Should execute quickly to avoid delaying AI responses
- Can influence compaction strategy through context modifications
