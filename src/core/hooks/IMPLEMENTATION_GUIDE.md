# Cline Hooks Implementation Guide

This guide provides comprehensive documentation for implementing and using the Cline Hooks system. It covers both end-user hook creation and Cline developer implementation of new hook types.

---

## Table of Contents

1. [Overview](#overview)
2. [User Guide: Creating Hooks](#user-guide-creating-hooks)
3. [Developer Guide: Adding New Hook Types](#developer-guide-adding-new-hook-types)
4. [Planned Hooks Implementation Map](#planned-hooks-implementation-map)
5. [Hook Design Patterns](#hook-design-patterns)
6. [Examples](#examples)
7. [Troubleshooting](#troubleshooting)

---

## Overview

### What Are Hooks?

Hooks are executable scripts that Cline runs at specific points during task execution. They allow you to:
- **Intercept and control** tool execution
- **Add custom validation** before operations
- **Inject additional context** into the conversation
- **Integrate with external systems** (logging, CI/CD, compliance)
- **Enforce project-specific policies**

### Hook Architecture

```
User Action → Cline Task → Hook Execution Point → Hook Script
                                 ↓
                            Hook Result (JSON)
                                 ↓
                    Continue/Block + Context Modification
```

### Currently Implemented Hooks

- **PreToolUse** - Runs before any tool execution (read_file, write_to_file, etc.)
- **PostToolUse** - Runs after tool execution completes

### Planned Hooks (Not Yet Implemented)

- **UserPromptSubmit** - Runs when user submits a new message
- **TaskStart** - Runs when a new task begins
- **TaskResume** - Runs when resuming a task from history
- **TaskCancel** - Runs when a task is cancelled
- **TaskComplete** - Runs when a task completes successfully
- **PreCompact** - Runs before context auto-condensation

---

## User Guide: Creating Hooks

This section is for users who want to add hooks to their projects.

### Quick Start

1. **Create the hooks directory:**
   ```bash
   mkdir -p .clinerules/hooks
   ```

2. **Create a hook script:**
   ```bash
   touch .clinerules/hooks/PreToolUse
   chmod +x .clinerules/hooks/PreToolUse
   ```

3. **Implement the hook logic** (see examples below)

### Hook Script Requirements

#### 1. Naming

Hook scripts **must** be named exactly as the hook type (case-sensitive):
- `PreToolUse` ✓
- `pretooluse` ✗
- `pre_tool_use` ✗

#### 2. Executable Permissions

On Unix/macOS systems, hooks must be executable:
```bash
chmod +x .clinerules/hooks/PreToolUse
```

On Windows, use appropriate file extensions (`.bat`, `.cmd`, `.exe`) that are in `PATHEXT`.

#### 3. Input/Output Format

**Input:** JSON on stdin
**Output:** JSON on stdout

### Hook Input Schema

All hooks receive this common structure:

```typescript
{
  "clineVersion": "3.32.6",      // Cline extension version
  "hookName": "PreToolUse",      // Name of the hook being executed
  "timestamp": "1704067200000",  // Unix timestamp (milliseconds)
  "taskId": "abc123",            // Unique task identifier
  "workspaceRoots": [            // Array of workspace root paths
    "/path/to/workspace"
  ],
  "userId": "user-id",           // Anonymized user ID
  
  // Hook-specific data (oneof)
  "preToolUse": {
    "toolName": "write_to_file",
    "parameters": {
      "path": "src/index.ts",
      "content": "..."
    }
  }
}
```

### Hook Output Schema

All hooks must return this structure:

```typescript
{
  "shouldContinue": true,        // true = proceed, false = block
  "errorMessage": "",            // Error message to display (if blocked)
  "contextModification": ""      // Additional context to inject (optional)
}
```

**Critical Rules:**
1. **Always output valid JSON** - Invalid JSON causes hook failure
2. **Default to `shouldContinue: true`** - Only block when necessary
3. **Provide clear error messages** - Users need to understand why
4. **Keep execution fast** - Hooks block operations synchronously

### Hook-Specific Data Structures

#### PreToolUse

```typescript
"preToolUse": {
  "toolName": string,           // Tool being executed
  "parameters": {               // Tool parameters (all strings)
    "path": "...",
    "content": "...",
    // ... other tool-specific params
  }
}
```

#### PostToolUse

```typescript
"postToolUse": {
  "toolName": string,           // Tool that was executed
  "parameters": { ... },        // Same as PreToolUse
  "result": string,             // Tool execution result
  "success": boolean,           // Whether tool succeeded
  "executionTimeMs": 1234       // Execution duration
}
```

### Common Use Cases

#### 1. Security - Block Dangerous Commands

```bash
#!/usr/bin/env bash
set -eu

input=$(cat)
tool=$(echo "$input" | jq -r '.preToolUse.toolName')

if [ "$tool" = "execute_command" ]; then
  cmd=$(echo "$input" | jq -r '.preToolUse.parameters.command')
  
  if echo "$cmd" | grep -q "rm -rf"; then
    cat <<EOF
{
  "shouldContinue": false,
  "errorMessage": "Dangerous command blocked: rm -rf"
}
EOF
    exit 0
  fi
fi

echo '{"shouldContinue": true}'
```

#### 2. Compliance - Prevent Sensitive File Modification

```python
#!/usr/bin/env python3
import sys
import json

input_data = json.load(sys.stdin)
tool = input_data.get('preToolUse', {}).get('toolName', '')
params = input_data.get('preToolUse', {}).get('parameters', {})

# Block modifications to sensitive files
sensitive_files = ['.env', '.env.local', 'secrets.json', 'credentials.yml']

if tool in ['write_to_file', 'replace_in_file']:
    path = params.get('path', '')
    if any(path.endswith(f) for f in sensitive_files):
        output = {
            "shouldContinue": False,
            "errorMessage": f"Cannot modify sensitive file: {path}"
        }
    else:
        output = {"shouldContinue": True}
else:
    output = {"shouldContinue": True}

print(json.dumps(output))
```

#### 3. Integration - Log Tool Usage

```javascript
#!/usr/bin/env node
const fs = require('fs');

const input = JSON.parse(
  fs.readFileSync(0, 'utf-8')
);

// Log all tool usage to a file
const logEntry = {
  timestamp: new Date().toISOString(),
  taskId: input.taskId,
  tool: input.postToolUse?.toolName,
  success: input.postToolUse?.success,
  duration: input.postToolUse?.executionTimeMs
};

fs.appendFileSync(
  '.cline-audit.log',
  JSON.stringify(logEntry) + '\n'
);

// Always allow - this is just logging
console.log(JSON.stringify({ shouldContinue: true }));
```

#### 4. Workflow - Auto-format Before Writing

```python
#!/usr/bin/env python3
import sys
import json
import subprocess

input_data = json.load(sys.stdin)
tool = input_data.get('preToolUse', {}).get('toolName', '')
params = input_data.get('preToolUse', {}).get('parameters', {})

if tool == 'write_to_file':
    path = params.get('path', '')
    content = params.get('content', '')
    
    # Format TypeScript/JavaScript files
    if path.endswith(('.ts', '.tsx', '.js', '.jsx')):
        try:
            # Run prettier on the content
            result = subprocess.run(
                ['npx', 'prettier', '--parser', 'typescript'],
                input=content.encode(),
                capture_output=True,
                timeout=5
            )
            
            if result.returncode == 0:
                formatted = result.stdout.decode()
                output = {
                    "shouldContinue": True,
                    "contextModification": f"Auto-formatted {path} with Prettier"
                }
            else:
                output = {"shouldContinue": True}
        except Exception:
            output = {"shouldContinue": True}
    else:
        output = {"shouldContinue": True}
else:
    output = {"shouldContinue": True}

print(json.dumps(output))
```

### Multi-Root Workspace Support

If you have multiple workspace folders, Cline will:
1. Search for `.clinerules/hooks/` in each workspace root
2. Execute all matching hooks in order
3. Combine results:
   - If **any** hook returns `shouldContinue: false`, execution is blocked
   - All `contextModification` strings are concatenated
   - All `errorMessage` strings are combined

### Testing Your Hooks

1. **Test JSON parsing:**
   ```bash
   echo '{"clineVersion":"3.32.6","hookName":"PreToolUse","timestamp":"1704067200000","taskId":"test","workspaceRoots":["/test"],"userId":"test","preToolUse":{"toolName":"write_to_file","parameters":{"path":"test.txt","content":"test"}}}' | .clinerules/hooks/PreToolUse | jq
   ```

2. **Test in Cline:**
   - Open your project in VSCode with Cline
   - Try using a tool that triggers your hook
   - Check the Cline chat for hook messages

3. **Debug output:**
   ```bash
   # Temporarily add debugging
   echo "Debug: Tool is $tool_name" >&2
   ```
   Check Debug Console in VSCode for stderr output.

---

## Developer Guide: Adding New Hook Types

This section is for Cline developers who want to add new hook capabilities.

### Implementation Process Overview

1. Define hook in Protocol Buffer schema
2. Update TypeScript interfaces
3. Generate code from protos
4. Add hook execution point in codebase
5. Handle hook results appropriately
6. Add tests
7. Update documentation

### Step 1: Define Hook in Protobuf

Edit `proto/cline/hooks.proto`:

```protobuf
message HookInput {
  string cline_version = 1;
  string hook_name = 2;
  string timestamp = 3;
  string task_id = 4;
  repeated string workspace_roots = 5;
  string user_id = 6;
  oneof data {
    PreToolUseData pre_tool_use = 10;
    PostToolUseData post_tool_use = 11;
    TaskStartData task_start = 12;        // NEW HOOK
  }
}

// Define the new hook's data structure
message TaskStartData {
  string initial_prompt = 1;
  repeated string images = 2;
  repeated string files = 3;
}
```

**Design Guidelines:**
- Use descriptive field names
- Mark optional fields appropriately
- Consider backward compatibility
- Document field purposes

### Step 2: Update TypeScript Interfaces

Edit `src/core/hooks/hook-factory.ts`:

```typescript
export interface Hooks {
  PreToolUse: {
    preToolUse: PreToolUseData
  }
  PostToolUse: {
    postToolUse: PostToolUseData
  }
  TaskStart: {                    // NEW HOOK
    taskStart: TaskStartData
  }
}
```

### Step 3: Generate TypeScript Types

```bash
npm run protos
```

This generates types in `src/shared/proto/cline/hooks.ts`.

### Step 4: Add Hook Execution Point

Identify the correct location in the codebase and add hook execution logic.

**Example: TaskStart Hook in `src/core/task/index.ts`:**

```typescript
private async startTask(task?: string, images?: string[], files?: string[]): Promise<void> {
  try {
    await this.clineIgnoreController.initialize()
  } catch (error) {
    console.error("Failed to initialize ClineIgnoreController:", error)
  }

  // NEW: Execute TaskStart hook
  const hooksEnabled = this.stateManager.getGlobalSettingsKey("hooksEnabled")
  if (hooksEnabled) {
    try {
      const hookFactory = new HookFactory()
      const taskStartHook = await hookFactory.create("TaskStart")
      
      const result = await taskStartHook.run({
        taskId: this.taskId,
        taskStart: {
          initialPrompt: task || "",
          images: images || [],
          files: files || [],
        },
      })
      
      if (!result.shouldContinue) {
        const errorMessage = result.errorMessage || "TaskStart hook prevented task from starting"
        await this.say("error", errorMessage)
        // Clean up and return early
        await this.abortTask()
        return
      }
      
      // Handle context modification if provided
      if (result.contextModification) {
        // TODO: Inject context into task initialization
        // For now, just log it
        await this.say("text", result.contextModification)
      }
    } catch (hookError) {
      const errorMessage = `TaskStart hook failed: ${hookError.toString()}`
      console.error(errorMessage)
      // Decide: continue anyway or abort?
      // For now, we'll continue but log the error
      await this.say("error", errorMessage)
    }
  }

  // Continue with existing task initialization...
  this.messageStateHandler.setClineMessages([])
  this.messageStateHandler.setApiConversationHistory([])
  // ... rest of startTask implementation
}
```

**Key Considerations:**
1. **Error Handling:** Decide whether hook failures should block execution
2. **Context Modification:** Implement injection mechanism if needed
3. **Performance:** Keep hook execution fast to avoid UX lag
4. **User Feedback:** Provide clear messages about hook actions

### Step 5: Handle Hook Results

Different hooks may need different result handling:

#### Blocking Hooks
Hooks that can prevent an action (PreToolUse, TaskStart, etc.):
```typescript
if (!result.shouldContinue) {
  await this.say("error", result.errorMessage || "Hook prevented execution")
  // Clean up resources
  // Return or throw as appropriate
  return
}
```

#### Logging Hooks
Hooks that just observe (PostToolUse, TaskComplete, etc.):
```typescript
// Hook runs in finally block or after action
// Errors are logged but don't affect execution
try {
  await hookRunner.run(hookData)
} catch (error) {
  console.error(`Hook ${hookName} failed:`, error)
  // Continue anyway - this is just logging
}
```

#### Context-Modifying Hooks
Hooks that can inject information:
```typescript
if (result.contextModification) {
  // Add to user message content for next API request
  userContent.push({
    type: "text",
    text: `[Hook Context]\n${result.contextModification}`
  })
}
```

### Step 6: Add Tests

Create test files following TDD principles:

```typescript
// src/core/hooks/__tests__/TaskStartHook.test.ts
import { describe, it, expect, beforeEach } from '@jest/globals'
import { HookFactory } from '../hook-factory'

describe('TaskStart Hook', () => {
  let hookFactory: HookFactory
  
  beforeEach(() => {
    hookFactory = new HookFactory()
  })
  
  it('should execute TaskStart hook successfully', async () => {
    const hook = await hookFactory.create('TaskStart')
    const result = await hook.run({
      taskId: 'test-task',
      taskStart: {
        initialPrompt: 'Create a README file',
        images: [],
        files: [],
      }
    })
    
    expect(result.shouldContinue).toBe(true)
  })
  
  it('should allow hook to block task start', async () => {
    // Setup mock hook that returns shouldContinue: false
    // Test that task doesn't start
  })
  
  it('should handle hook failures gracefully', async () => {
    // Setup mock hook that throws error
    // Test that error is caught and handled
  })
})
```

### Step 7: Update Documentation

1. Update `README.md` with hook description
2. Add hook to this implementation guide
3. Provide code examples
4. Document any special considerations

---

## Planned Hooks Implementation Map

This section maps each planned hook to its implementation location in the codebase.

### 1. UserPromptSubmit Hook

**Purpose:** Runs when user submits a new message/prompt to Cline.

**Use Cases:**
- Validate prompts before processing
- Add project context automatically
- Enforce prompt templates
- Log user interactions

**Implementation Location:**
- **File:** `src/core/task/index.ts`
- **Method:** `async initiateTaskLoop(userContent: UserContent)`
- **Timing:** After user content is prepared, before API request

**Implementation Strategy:**
```typescript
private async initiateTaskLoop(userContent: UserContent): Promise<void> {
  // NEW: Execute UserPromptSubmit hook
  const hooksEnabled = this.stateManager.getGlobalSettingsKey("hooksEnabled")
  if (hooksEnabled) {
    try {
      const hookFactory = new HookFactory()
      const hook = await hookFactory.create("UserPromptSubmit")
      
      // Extract text content from userContent blocks
      const promptText = userContent
        .filter(block => block.type === 'text')
        .map(block => block.text)
        .join('\n')
      
      const result = await hook.run({
        taskId: this.taskId,
        userPromptSubmit: {
          prompt: promptText,
          hasImages: userContent.some(block => block.type === 'image'),
          hasFiles: userContent.some(block => 
            block.type === 'text' && block.text?.includes('file://')
          ),
        },
      })
      
      if (!result.shouldContinue) {
        await this.say("error", result.errorMessage || "Prompt blocked by hook")
        // Don't proceed with API request
        return
      }
      
      if (result.contextModification) {
        // Inject additional context
        userContent.push({
          type: "text",
          text: `\n\n[Hook Context]\n${result.contextModification}`
        })
      }
    } catch (error) {
      console.error("UserPromptSubmit hook failed:", error)
      await this.say("error", `Hook error: ${error}`)
    }
  }
  
  // Continue with existing API request logic
  let nextUserContent = userContent
  let includeFileDetails = true
  while (!this.taskState.abort) {
    // ... existing loop logic
  }
}
```

**Proto Definition:**
```protobuf
message UserPromptSubmitData {
  string prompt = 1;
  bool has_images = 2;
  bool has_files = 3;
}
```

---

### 2. TaskStart Hook

**Purpose:** Runs when a new task begins (not resuming).

**Use Cases:**
- Initialize project-specific context
- Set up logging/monitoring
- Validate task prerequisites
- Add custom instructions

**Implementation Location:**
- **File:** `src/core/task/index.ts`
- **Method:** `private async startTask(task?: string, images?: string[], files?: string[])`
- **Timing:** After initialization, before first API request

**Implementation Strategy:**
```typescript
private async startTask(task?: string, images?: string[], files?: string[]): Promise<void> {
  try {
    await this.clineIgnoreController.initialize()
  } catch (error) {
    console.error("Failed to initialize ClineIgnoreController:", error)
  }
  
  // Initialize message history
  this.messageStateHandler.setClineMessages([])
  this.messageStateHandler.setApiConversationHistory([])
  await this.postStateToWebview()

  // NEW: Execute TaskStart hook
  const hooksEnabled = this.stateManager.getGlobalSettingsKey("hooksEnabled")
  if (hooksEnabled) {
    try {
      const hookFactory = new HookFactory()
      const hook = await hookFactory.create("TaskStart")
      
      const result = await hook.run({
        taskId: this.taskId,
        taskStart: {
          initialPrompt: task || "",
          images: images || [],
          files: files || [],
        },
      })
      
      if (!result.shouldContinue) {
        await this.say("error", result.errorMessage || "Task blocked by hook")
        await this.abortTask()
        return
      }
      
      if (result.contextModification) {
        // Add context to the initial message
        const enhancedTask = `${task}\n\n[Project Context]\n${result.contextModification}`
        task = enhancedTask
      }
    } catch (error) {
      console.error("TaskStart hook failed:", error)
      await this.say("error", `TaskStart hook failed: ${error}`)
    }
  }

  // Continue with task initialization
  await this.say("text", task, images, files)
  this.taskState.isInitialized = true
  // ... rest of startTask
}
```

**Proto Definition:**
```protobuf
message TaskStartData {
  string initial_prompt = 1;
  repeated string images = 2;
  repeated string files = 3;
}
```

---

### 3. TaskResume Hook

**Purpose:** Runs when resuming a task from history.

**Use Cases:**
- Refresh project state
- Validate that dependencies still exist
- Update context based on time elapsed
- Log task resumption

**Implementation Location:**
- **File:** `src/core/task/index.ts`
- **Method:** `private async resumeTaskFromHistory()`
- **Timing:** After loading saved state, before resuming execution

**Implementation Strategy:**
```typescript
private async resumeTaskFromHistory() {
  try {
    await this.clineIgnoreController.initialize()
  } catch (error) {
    console.error("Failed to initialize ClineIgnoreController:", error)
  }

  // Load saved messages
  const savedClineMessages = await getSavedClineMessages(this.taskId)
  // ... existing message processing ...
  
  // Load API history
  const savedApiConversationHistory = await getSavedApiConversationHistory(this.taskId)
  this.messageStateHandler.setApiConversationHistory(savedApiConversationHistory)
  
  // Load context history
  await ensureTaskDirectoryExists(this.taskId)
  await this.contextManager.initializeContextHistory(
    await ensureTaskDirectoryExists(this.taskId)
  )

  // NEW: Execute TaskResume hook
  const hooksEnabled = this.stateManager.getGlobalSettingsKey("hooksEnabled")
  if (hooksEnabled) {
    try {
      const hookFactory = new HookFactory()
      const hook = await hookFactory.create("TaskResume")
      
      const lastMessage = this.messageStateHandler
        .getClineMessages()
        .slice()
        .reverse()
        .find((m) => !(m.ask === "resume_task" || m.ask === "resume_completed_task"))
      
      const timeSinceLastMessage = lastMessage?.ts 
        ? Date.now() - lastMessage.ts 
        : 0
      
      const result = await hook.run({
        taskId: this.taskId,
        taskResume: {
          timeSinceLastMessageMs: timeSinceLastMessage,
          wasCompleted: lastMessage?.ask === "completion_result",
          messageCount: savedClineMessages.length,
        },
      })
      
      if (!result.shouldContinue) {
        await this.say("error", result.errorMessage || "Task resume blocked by hook")
        await this.abortTask()
        return
      }
      
      if (result.contextModification) {
        // Add to resume message
        await this.say("text", result.contextModification)
      }
    } catch (error) {
      console.error("TaskResume hook failed:", error)
      await this.say("error", `TaskResume hook failed: ${error}`)
    }
  }

  // Continue with existing resume logic
  const lastClineMessage = this.messageStateHandler
    .getClineMessages()
    .slice()
    .reverse()
    .find((m) => !(m.ask === "resume_task" || m.ask === "resume_completed_task"))
  
  // ... rest of resumeTaskFromHistory
}
```

**Proto Definition:**
```protobuf
message TaskResumeData {
  int64 time_since_last_message_ms = 1;
  bool was_completed = 2;
  int32 message_count = 3;
}
```

---

### 4. TaskCancel Hook

**Purpose:** Runs when a task is cancelled/aborted.

**Use Cases:**
- Clean up external resources
- Log task cancellation
- Revert partial changes
- Notify external systems

**Implementation Location:**
- **File:** `src/core/task/index.ts`
- **Method:** `async abortTask()`
- **Timing:** At the beginning of abort, before cleanup

**Implementation Strategy:**
```typescript
async abortTask() {
  // Check for incomplete progress before aborting
  if (this.FocusChainManager) {
    this.FocusChainManager.checkIncompleteProgressOnCompletion()
  }

  // NEW: Execute TaskCancel hook
  const hooksEnabled = this.stateManager.getGlobalSettingsKey("hooksEnabled")
  if (hooksEnabled) {
    try {
      const hookFactory = new HookFactory()
      const hook = await hookFactory.create("TaskCancel")
      
      const clineMessages = this.messageStateHandler.getClineMessages()
      const apiReqCount = clineMessages.filter(m => m.say === "api_req_started").length
      
      const result = await hook.run({
        taskId: this.taskId,
        taskCancel: {
          apiRequestCount: apiReqCount,
          wasInterrupted: this.taskState.isStreaming,
          messageCount: clineMessages.length,
        },
      })
      
      // Note: We always continue with cancellation
      // The hook can't prevent cancellation, but can take actions
      
      if (result.contextModification) {
        // Log the context as a message
        await this.say("text", `[Task Cancelled]\n${result.contextModification}`)
      }
      
      if (result.errorMessage) {
        // Log any hook errors
        console.error("TaskCancel hook message:", result.errorMessage)
      }
    } catch (error) {
      // Log but don't block cancellation
      console.error("TaskCancel hook failed:", error)
    }
  }

  // Continue with existing abort logic
  this.taskState.abort = true
  this.terminalManager.disposeAll()
  this.urlContentFetcher.closeBrowser()
  await this.browserSession.dispose()
  this.clineIgnoreController.dispose()
  this.fileContextTracker.dispose()
  await this.diffViewProvider.revertChanges()
  this.mcpHub.clearNotificationCallback()
  if (this.FocusChainManager) {
    this.FocusChainManager.dispose()
  }
}
```

**Proto Definition:**
```protobuf
message TaskCancelData {
  int32 api_request_count = 1;
  bool was_interrupted = 2;
  int32 message_count = 3;
}
```

**Note:** This hook should NOT be able to prevent cancellation (no `shouldContinue` check).

---

### 5. TaskComplete Hook

**Purpose:** Runs when a task completes successfully (attempt_completion).

**Use Cases:**
- Log successful completion
- Run post-completion validation
- Update external systems
- Generate completion reports

**Implementation Location:**
- **File:** `src/core/task/tools/handlers/AttemptCompletionHandler.ts`
- **Method:** `async execute(config: TaskConfig, block: ToolUse)`
- **Timing:** After completion is approved by user, before final message

**Implementation Strategy:**
```typescript
// In AttemptCompletionHandler.execute()
async execute(config: TaskConfig, block: ToolUse): Promise<ToolResponse> {
  const { result, command } = block.params
  
  // ... existing validation and user approval logic ...
  
  // After user approves completion
  if (userResponse === "yesButtonClicked") {
    // NEW: Execute TaskComplete hook
    const hooksEnabled = config.stateManager.getGlobalSettingsKey("hooksEnabled")
    if (hooksEnabled) {
      try {
        const hookFactory = new HookFactory()
        const hook = await hookFactory.create("TaskComplete")
        
        const clineMessages = config.messageState.getClineMessages()
        const apiReqCount = clineMessages.filter(m => m.say === "api_req_started").length
        
        const hookResult = await hook.run({
          taskId: config.taskId,
          taskComplete: {
            result: result || "",
            hadCommand: !!command,
            apiRequestCount: apiReqCount,
            messageCount: clineMessages.length,
          },
        })
        
        // Note: Hook can't prevent completion at this point
        // but can log or take actions
        
        if (hookResult.contextModification) {
          await config.callbacks.say("text", hookResult.contextModification)
        }
        
        if (hookResult.errorMessage) {
          console.error("TaskComplete hook message:", hookResult.errorMessage)
        }
      } catch (error) {
        console.error("TaskComplete hook failed:", error)
      }
    }
    
    // Continue with existing completion logic
    await config.callbacks.say("completion_result", result)
    
    if (command) {
      config.callbacks.executeCommandTool(command, undefined)
    }
  }
  
  return ""
}
```

**Proto Definition:**
```protobuf
message TaskCompleteData {
  string result = 1;
  bool had_command = 2;
  int32 api_request_count = 3;
  int32 message_count = 4;
}
```

---

### 6. PreCompact Hook

**Purpose:** Runs before automatic context compaction/truncation.

**Use Cases:**
- Save important context before compaction
- Customize what gets kept vs removed
- Log context management events
- Generate summaries

**Implementation Location:**
- **File:** `src/core/context/context-management/ContextManager.ts`
- **Method:** `shouldCompactContextWindow()` or before `getNextTruncationRange()`
- **Timing:** After detecting need for compaction, before actual truncation

**Implementation Strategy:**
```typescript
// In ContextManager class
async shouldCompactContextWindow(
  clineMessages: ClineMessage[],
  api: ApiHandler,
  previousApiReqIndex: number,
  autoCondenseThreshold?: number
): Promise<boolean> {
  const useAutoCondense = /* ... determine from settings ... */
  
  if (!useAutoCondense) {
    return false // Use legacy method
  }
  
  // Check if we need to compact
  const shouldCompact = /* ... existing logic ... */
  
  if (shouldCompact) {
    // NEW: Execute PreCompact hook before truncation
    const hooksEnabled = /* get from state manager */
    if (hooksEnabled) {
      try {
        const hookFactory = new HookFactory()
        const hook = await hookFactory.create("PreCompact")
        
        const apiHistory = /* get API conversation history */
        const truncationRange = /* calculate what will be truncated */
        
        const messagesToRemove = apiHistory.slice(
          truncationRange[0],
          truncationRange[1] + 1
        )
        
        const result = await hook.run({
          taskId: /* task ID */,
          preCompact: {
            messagesToRemoveCount: messagesToRemove.length,
            totalMessageCount: apiHistory.length,
            estimatedTokensSaved: /* calculate */,
            compactionReason: "approaching_context_limit",
          },
        })
        
        // Note: Hook cannot prevent compaction
        // but can save data or log the event
        
        if (result.contextModification) {
          // Could inject summary into conversation
          console.log("PreCompact context:", result.contextModification)
        }
        
        if (result.errorMessage) {
          console.error("PreCompact hook message:", result.errorMessage)
        }
      } catch (error) {
        console.error("PreCompact hook failed:", error)
      }
    }
  }
  
  return shouldCompact
}
```

**Proto Definition:**
```protobuf
message PreCompactData {
  int32 messages_to_remove_count = 1;
  int32 total_message_count = 2;
  int32 estimated_tokens_saved = 3;
  string compaction_reason = 4;  // "approaching_context_limit", "model_switched", etc.
}
```

**Note:** This hook should NOT be able to prevent compaction, only observe and take actions.

---

## Hook Design Patterns

### Pattern 1: Validation Hook (Blocking)

**Purpose:** Prevent actions that violate policies

**Characteristics:**
- Returns `shouldContinue: false` to block
- Provides clear error message
- Fast execution (< 100ms)
- Deterministic logic

**Example Hooks:** PreToolUse, TaskStart, UserPromptSubmit

**Template:**
```python
#!/usr/bin/env python3
import sys
import json

input_data = json.load(sys.stdin)

# Extract relevant data
# ... validation logic ...

if validation_failed:
    output = {
        "shouldContinue": False,
        "errorMessage": "Clear explanation of why it failed"
    }
else:
    output = {"shouldContinue": True}

print(json.dumps(output))
```

### Pattern 2: Observability Hook (Non-blocking)

**Purpose:** Log, monitor, or track actions without interfering

**Characteristics:**
- Always returns `shouldContinue: true`
- Can fail without affecting execution
- May have external I/O (logging, metrics)
- Runs in finally block or after action

**Example Hooks:** PostToolUse, TaskComplete, TaskCancel

**Template:**
```javascript
#!/usr/bin/env node
const fs = require('fs');

try {
  const input = JSON.parse(fs.readFileSync(0, 'utf-8'));
  
  // Log to external system
  logToExternalSystem(input);
  
  // Always allow execution to continue
  console.log(JSON.stringify({ shouldContinue: true }));
} catch (error) {
  // Even on error, allow execution
  console.error('Hook error:', error);
  console.log(JSON.stringify({ shouldContinue: true }));
}
```

### Pattern 3: Context Enhancement Hook

**Purpose:** Add information to the conversation

**Characteristics:**
- Returns `contextModification` with additional data
- Usually doesn't block (`shouldContinue: true`)
- Can query external systems
- Performance-sensitive (cached data preferred)

**Example Hooks:** TaskStart, TaskResume, PreCompact

**Template:**
```bash
#!/usr/bin/env bash
set -eu

input=$(cat)

# Gather additional context
project_info=$(cat .project-context.json 2>/dev/null || echo "{}")

# Return context modification
cat <<EOF
{
  "shouldContinue": true,
  "contextModification": "Project Context: $project_info"
}
EOF
```

### Pattern 4: Integration Hook

**Purpose:** Connect Cline to external systems (CI/CD, issue trackers, etc.)

**Characteristics:**
- Makes external API calls
- Handles network failures gracefully
- Uses authentication/credentials
- May update external state

**Example Hooks:** TaskComplete, PostToolUse

**Template:**
```python
#!/usr/bin/env python3
import sys
import json
import requests
from os import environ

input_data = json.load(sys.stdin)

try:
    # Call external API
    response = requests.post(
        environ['WEBHOOK_URL'],
        json={
            'task_id': input_data['taskId'],
            'event': input_data['hookName'],
            # ... other data
        },
        timeout=5
    )
    
    output = {
        "shouldContinue": True,
        "contextModification": f"Notified webhook: {response.status_code}"
    }
except Exception as e:
    # Don't block on external failures
    output = {
        "shouldContinue": True,
        "errorMessage": f"Webhook failed: {e}"
    }

print(json.dumps(output))
```

---

## Examples

### Complete Example 1: Security Policy Enforcement

```bash
#!/usr/bin/env bash
# .clinerules/hooks/PreToolUse
# Enforce security policies for file operations and commands

set -eu

input=$(cat)

tool=$(echo "$input" | jq -r '.preToolUse.toolName')
params=$(echo "$input" | jq -r '.preToolUse.parameters')

# Block dangerous command patterns
if [ "$tool" = "execute_command" ]; then
  cmd=$(echo "$params" | jq -r '.command')
  
  # Check for dangerous patterns
  if echo "$cmd" | grep -qE "(rm -rf|sudo|chmod 777|> /dev/)"; then
    cat <<EOF
{
  "shouldContinue": false,
  "errorMessage": "Security policy: Dangerous command blocked"
}
EOF
    exit 0
  fi
fi

# Block modifications to protected files
if [ "$tool" = "write_to_file" ] || [ "$tool" = "replace_in_file" ]; then
  path=$(echo "$params" | jq -r '.path')
  
  # Protected files list
  if echo "$path" | grep -qE "(.env|secrets|credentials|private)"; then
    cat <<EOF
{
  "shouldContinue": false,
  "errorMessage": "Security policy: Cannot modify protected file: $path"
}
EOF
    exit 0
  fi
fi

# Allow all other operations
echo '{"shouldContinue": true}'
```

### Complete Example 2: Project Context Injection

```python
#!/usr/bin/env python3
# .clinerules/hooks/TaskStart
# Automatically inject project-specific context when tasks start

import sys
import json
import os
from pathlib import Path

input_data = json.load(sys.stdin)

# Build project context
context_parts = []

# Add README summary if exists
readme_path = Path('README.md')
if readme_path.exists():
    with open(readme_path) as f:
        # Get first 500 chars
        summary = f.read(500)
        context_parts.append(f"README Summary:\n{summary}")

# Add architecture notes if exists
arch_path = Path('ARCHITECTURE.md')
if arch_path.exists():
    context_parts.append("Architecture documentation available at ARCHITECTURE.md")

# Add active git branch
try:
    branch = os.popen('git branch --show-current').read().strip()
    if branch:
        context_parts.append(f"Current git branch: {branch}")
except:
    pass

# Combine context
if context_parts:
    context = "\n\n".join(context_parts)
    output = {
        "shouldContinue": True,
        "contextModification": f"PROJECT CONTEXT:\n{context}"
    }
else:
    output = {"shouldContinue": True}

print(json.dumps(output))
```

### Complete Example 3: Audit Logging

```javascript
#!/usr/bin/env node
// .clinerules/hooks/PostToolUse
// Log all tool usage for audit purposes

const fs = require('fs');
const path = require('path');

const input = JSON.parse(fs.readFileSync(0, 'utf-8'));

const postToolUse = input.postToolUse || {};

// Create audit log entry
const logEntry = {
  timestamp: new Date().toISOString(),
  taskId: input.taskId,
  userId: input.userId,
  tool: postToolUse.toolName,
  success: postToolUse.success,
  duration: postToolUse.executionTimeMs,
  parameters: postToolUse.parameters,
};

// Append to audit log
const logFile = path.join(process.cwd(), '.cline-audit.jsonl');
try {
  fs.appendFileSync(logFile, JSON.stringify(logEntry) + '\n');
} catch (error) {
  console.error('Failed to write audit log:', error);
}

// Always allow - this is just logging
console.log(JSON.stringify({ 
  shouldContinue: true,
  contextModification: `Logged to audit: ${postToolUse.toolName}`
}));
```

---

## Troubleshooting

### Hook Not Running

**Symptoms:** Hook script exists but doesn't execute

**Checklist:**
1. ✓ Hook is in `.clinerules/hooks/` in workspace root
2. ✓ Hook name matches exactly (case-sensitive)
3. ✓ Hook has executable permissions (`chmod +x`)
4. ✓ Hooks are enabled (`hooksEnabled: true` in settings)
5. ✓ Workspace roots are detected correctly
6. ✓ Check Debug Console for errors

**Debugging:**
```bash
# Test hook manually
echo '{"clineVersion":"3.32.6","hookName":"PreToolUse","timestamp":"1704067200000","taskId":"test","workspaceRoots":["/test"],"userId":"test","preToolUse":{"toolName":"write_to_file","parameters":{"path":"test.txt","content":"test"}}}' | .clinerules/hooks/PreToolUse
```

### Hook Fails with JSON Error

**Symptoms:** Hook executes but Cline shows "Failed to parse hook output"

**Causes:**
- Invalid JSON syntax
- Extra output to stdout (use stderr for debugging)
- Missing required fields

**Fix:**
```bash
# Validate JSON output
.clinerules/hooks/PreToolUse < test-input.json | jq .

# Send debug output to stderr
echo "Debug info" >&2
```

### Hook Blocks All Operations

**Symptoms:** All tools are blocked unexpectedly

**Causes:**
- Hook always returns `shouldContinue: false`
- Hook crashes and returns non-zero exit code
- Logic error in hook script

**Fix:**
1. Test hook in isolation
2. Add debug logging
3. Check for unhandled errors
4. Verify logic with test data

### Hook Execution Too Slow

**Symptoms:** Noticeable delay when using tools

**Causes:**
- Network requests in hook
- Heavy computation
- Large file operations
- No timeout on external calls

**Fix:**
1. Add timeouts to external calls
2. Cache expensive operations
3. Use async operations where possible
4. Consider moving logic to PostToolUse

### Hook Works Locally But Not in CI

**Symptoms:** Hook runs in development but fails in automated environments

**Causes:**
- Missing dependencies (jq, python, node)
- Different shell environment
- File permissions in CI
- Environment variables not set

**Fix:**
1. Document hook dependencies
2. Use `#!/usr/bin/env` shebang
3. Check file permissions in CI
4. Use CI environment variables

### Multiple Workspace Roots Conflict

**Symptoms:** Hooks from different workspace roots conflict

**Understanding:**
- All matching hooks run in order
- If ANY hook blocks, execution stops
- Results are combined

**Fix:**
1. Coordinate hooks across workspaces
2. Use hook context (workspace path) to specialize behavior
3. Consider consolidating hooks

---

## Best Practices Summary

### For Hook Authors (End Users)

1. **Start Simple** - Begin with basic validation, add complexity as needed
2. **Fail Open** - Default to `shouldContinue: true` unless there's a specific reason to block
3. **Clear Messages** - Error messages should explain WHY something was blocked
4. **Fast Execution** - Keep hooks under 100ms for good UX
5. **Handle Errors** - Catch exceptions and return valid JSON
6. **Test Thoroughly** - Test with various inputs before deploying
7. **Document Dependencies** - List any external tools required
8. **Version Control** - Commit hooks to repository
9. **Use stderr for Debug** - stdout is for JSON output only
10. **Monitor Performance** - Log slow hooks for optimization

### For Cline Developers

1. **Backward Compatibility** - Proto changes must not break existing hooks
2. **Clear Documentation** - Each hook type needs examples and use cases
3. **Error Resilience** - Hook failures shouldn't crash Cline
4. **Performance Monitoring** - Track hook execution time
5. **User Feedback** - Show hook status in UI when appropriate
6. **Test Coverage** - Write tests for hook integration
7. **Security Review** - Hooks execute arbitrary code, document risks
8. **Gradual Rollout** - Use feature flags for new hook types
9. **Telemetry** - Track hook adoption and failures
10. **Context Modification** - Implement injection mechanism consistently

---

## Additional Resources

- **Proto Schema:** `proto/cline/hooks.proto`
- **Hook Factory:** `src/core/hooks/hook-factory.ts`
- **Tool Executor:** `src/core/task/ToolExecutor.ts`
- **Example Hook:** `.clinerules/hooks/PreToolUse`

## Contributing

When adding new hooks or improving the system:

1. Follow the implementation process in this guide
2. Add comprehensive tests
3. Update all documentation
4. Provide migration guide for breaking changes
5. Announce new hooks in release notes

---

**Last Updated:** 2025-10-06  
**Cline Version:** 3.32.6
