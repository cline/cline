# Cline Hooks Documentation

## Overview

Cline hooks allow you to execute custom scripts at specific points in the agentic workflow. Hooks can be placed in either:
- **Global hooks directory**: `~/Documents/Cline/Rules/Hooks/` (applies to all workspaces)
- **Workspace hooks directory**: `.clinerules/hooks/` (applies to specific workspace)

Hooks run automatically when enabled.

## Enabling Hooks

1. Open Cline settings in VSCode
2. Navigate to the Feature Settings section
3. Check the "Enable Hooks" checkbox
4. Hooks must be executable files (on Unix/Linux/macOS use `chmod +x hookname`)

## Available Hooks

### TaskStart Hook
- **When**: Runs when a NEW task is started (not when resuming)
- **Purpose**: Initialize task context, validate task requirements, set up environment
- **Global Location**: `~/Documents/Cline/Rules/Hooks/TaskStart` (all platforms)
- **Workspace Location**: `.clinerules/hooks/TaskStart` (all platforms)

### TaskResume Hook
- **When**: Runs when an EXISTING task is resumed
- **Purpose**: Validate resumed task state, restore context, check for changes since last run
- **Global Location**: `~/Documents/Cline/Rules/Hooks/TaskResume` (all platforms)
- **Workspace Location**: `.clinerules/hooks/TaskResume` (all platforms)

### TaskCancel Hook
- **When**: Runs when a task is cancelled by the user
- **Purpose**: Clean up resources, log cancellation, save state
- **Global Location**: `~/Documents/Cline/Rules/Hooks/TaskCancel` (all platforms)
- **Workspace Location**: `.clinerules/hooks/TaskCancel` (all platforms)

### UserPromptSubmit Hook
- **When**: Runs when the user submits a prompt/message
- **Purpose**: Validate user input, preprocess prompts, add context to user messages
- **Global Location**: `~/Documents/Cline/Rules/Hooks/UserPromptSubmit` (all platforms)
- **Workspace Location**: `.clinerules/hooks/UserPromptSubmit` (all platforms)

### PreToolUse Hook
- **When**: Runs BEFORE a tool is executed
- **Purpose**: Validate parameters, block execution, or add context
- **Global Location**: `~/Documents/Cline/Rules/Hooks/PreToolUse` (all platforms)
- **Workspace Location**: `.clinerules/hooks/PreToolUse` (all platforms)

### PostToolUse Hook
- **When**: Runs AFTER a tool completes
- **Purpose**: Observe results, track patterns, or add context
- **Global Location**: `~/Documents/Cline/Rules/Hooks/PostToolUse` (all platforms)
- **Workspace Location**: `.clinerules/hooks/PostToolUse` (all platforms)

## Cross-Platform Hook Format

Cline uses a git-style approach for hooks that works consistently across all platforms:

### Hook Files (All Platforms)
- **No file extensions**: Hooks are named exactly `PreToolUse` or `PostToolUse` (no `.bat`, `.cmd`, `.sh` etc.)
- **Shebang required**: First line must be a shebang (e.g., `#!/usr/bin/env bash` or `#!/usr/bin/env node`)
- **Executable on Unix**: On Unix/Linux/macOS, hooks must be executable: `chmod +x PreToolUse`
- **Windows**: No special permissions needed - hooks are executed through the shell

### How It Works

Like git hooks, Cline executes hook files through a shell that interprets the shebang line:
- On Unix/Linux/macOS: Native shell execution with shebang support
- On Windows: Shell execution handles shebang interpretation

This means:
- ✅ Same hook script works on all platforms
- ✅ Write once, run anywhere
- ✅ Use any scripting language (bash, node, python, etc.)

### Creating Hooks

**On Unix/Linux/macOS:**
```bash
# Create hook file
nano ~/Documents/Cline/Rules/Hooks/PreToolUse

# Make executable
chmod +x ~/Documents/Cline/Rules/Hooks/PreToolUse
```

**On Windows:**
```batch
REM Create hook file (note: no file extension)
notepad %USERPROFILE%\Documents\Cline\Rules\Hooks\PreToolUse
```

## Context Injection Timing

**IMPORTANT**: Context injected by hooks affects **FUTURE AI decisions**, not the current tool execution.

### Why This Matters

When a hook runs:
1. The AI has already decided what tool to use and with what parameters
2. The hook cannot modify those parameters
3. Context from the hook is added to the conversation
4. The AI sees this context in the **NEXT API request** and can adjust future decisions

### PreToolUse Hook Flow
```
1. AI decides: "I'll use write_to_file with these parameters"
2. PreToolUse hook runs → can block or add context
3. If allowed, tool executes with original parameters
4. Context is added to conversation
5. Next API request includes this context
6. AI adjusts future decisions based on context
```

### PostToolUse Hook Flow
```
1. Tool completes execution
2. PostToolUse hook runs → observes results
3. Hook adds context about the outcome
4. Context is added to conversation
5. Next API request includes this context
6. AI can learn from the results
```

## Hook Input/Output

### Input (via stdin as JSON)

All hooks receive:
```json
{
  "clineVersion": "string",
  "hookName": "TaskStart" | "TaskResume" | "TaskCancel" | "UserPromptSubmit" | "PreToolUse" | "PostToolUse",
  "timestamp": "string",
  "taskId": "string",
  "workspaceRoots": ["string"],
  "userId": "string",
  "taskStart": {  // Only for TaskStart
    "task": "string"
  },
  "taskResume": {  // Only for TaskResume
    "task": "string"
  },
  "taskCancel": {  // Only for TaskCancel
    "reason": "string"
  },
  "userPromptSubmit": {  // Only for UserPromptSubmit
    "prompt": "string"
  },
  "preToolUse": {  // Only for PreToolUse
    "toolName": "string",
    "parameters": {}
  },
  "postToolUse": {  // Only for PostToolUse
    "toolName": "string",
    "parameters": {},
    "result": "string",
    "success": boolean,
    "executionTimeMs": number
  }
}
```

### Output (via stdout as JSON)

All hooks must return:
```json
{
  "cancel": boolean,                   // Required: false to continue, true to block execution
  "contextModification": "string",     // Optional: Context for future AI decisions
  "errorMessage": "string"             // Optional: Error details if blocking
}
```

**Note**: The `cancel` field works as follows:
- `false` (or omitted): Allow execution to continue
- `true`: Block execution and show error message to user

## Context Modification Format

Use structured prefixes to help the AI understand context type:

- `WORKSPACE_RULES:` - Project conventions and requirements
- `FILE_OPERATIONS:` - File creation/modification patterns
- `TOOL_RESULT:` - Outcomes of tool executions
- `PERFORMANCE:` - Performance concerns
- `VALIDATION:` - Validation results
- Custom prefixes as needed

Example:
```bash
cat <<EOF
{
  "cancel": false,
  "contextModification": "WORKSPACE_RULES: This is a TypeScript project. All new files must use .ts or .tsx extensions."
}
EOF
```

## Hook Execution Limits

- **Timeout**: Hooks must complete within 30 seconds
- **Context Size**: Context modifications are limited to 50KB
- **Error Handling**: Unexpected file system errors are propagated; expected errors (file not found, permission denied) are handled silently

## Common Use Cases

### 1. Validation - Block Invalid Operations

```bash
#!/usr/bin/env bash
input=$(cat)
tool_name=$(echo "$input" | jq -r '.preToolUse.toolName')
path=$(echo "$input" | jq -r '.preToolUse.parameters.path // ""')

if [[ "$tool_name" == "write_to_file" && "$path" == *.js ]]; then
  cat <<EOF
{
  "cancel": true,
  "errorMessage": "Cannot create .js files in TypeScript project",
  "contextModification": "WORKSPACE_RULES: Use .ts/.tsx extensions only"
}
EOF
  exit 0
fi

echo '{"cancel": false}'
```

### 2. Context Building - Learn from Operations

```bash
#!/usr/bin/env bash
input=$(cat)
tool_name=$(echo "$input" | jq -r '.postToolUse.toolName')
success=$(echo "$input" | jq -r '.postToolUse.success')
path=$(echo "$input" | jq -r '.postToolUse.parameters.path // ""')

if [[ "$tool_name" == "write_to_file" && "$success" == "true" ]]; then
  cat <<EOF
{
  "cancel": false,
  "contextModification": "FILE_OPERATIONS: Created '$path'. Maintain consistency with this file's patterns in future operations."
}
EOF
else
  echo '{"cancel": false}'
fi
```

### 3. Performance Monitoring

```bash
#!/usr/bin/env bash
input=$(cat)
execution_time=$(echo "$input" | jq -r '.postToolUse.executionTimeMs')
tool_name=$(echo "$input" | jq -r '.postToolUse.toolName')

if [[ "$execution_time" -gt 5000 ]]; then
  cat <<EOF
{
  "cancel": false,
  "contextModification": "PERFORMANCE: Tool '$tool_name' took ${execution_time}ms. Consider optimizing future similar operations."
}
EOF
else
  echo '{"cancel": false}'
fi
```

### 4. Logging and Telemetry

```bash
#!/usr/bin/env bash
input=$(cat)

# Log to file
echo "$input" >> ~/.cline/hook-logs/tool-usage.jsonl

# Allow execution
echo '{"cancel": false}'
```

## Global vs Workspace Hooks

Cline supports two levels of hooks:

### Global Hooks
- **Location**: `~/Documents/Cline/Rules/Hooks/` (macOS/Linux) or `%USERPROFILE%\Documents\Cline\Rules\Hooks\` (Windows)
- **Scope**: Apply to ALL workspaces and projects
- **Use Case**: Organization-wide policies, personal preferences, universal validations
- **Priority**: Execute FIRST, before workspace hooks

### Workspace Hooks
- **Location**: `.clinerules/hooks/` in each workspace root
- **Scope**: Apply only to the specific workspace
- **Use Case**: Project-specific rules, team conventions, repository requirements
- **Priority**: Execute AFTER global hooks

### Hook Execution

When multiple hooks exist (global and/or workspace):
- All hooks for a given step are executed
- **Execution order is not guaranteed** - hooks may run concurrently
- If ALL hooks allow execution (`cancel: false`), the tool proceeds
- If ANY hook blocks (`cancel: true`), execution is blocked

**Result Combination:**
- `cancel`: If ANY hook returns `true`, execution is blocked
- `contextModification`: All context strings are concatenated
- `errorMessage`: All error messages are concatenated

### Setting Up Global Hooks

1. The global hooks directory is automatically created at:
   - macOS/Linux: `~/Documents/Cline/Rules/Hooks/`
   - Windows: `%USERPROFILE%\Documents\Cline\Rules\Hooks\`

2. Add your hook script:
   ```bash
   # Unix/Linux/macOS
   nano ~/Documents/Cline/Rules/Hooks/PreToolUse
   chmod +x ~/Documents/Cline/Rules/Hooks/PreToolUse
   
   # Windows
   notepad %USERPROFILE%\Documents\Cline\Rules\Hooks\PreToolUse
   ```

3. Enable hooks in Cline settings

### Example: Global + Workspace Hooks

**Global Hook** (applies to all projects):
```bash
#!/usr/bin/env bash
# ~/Documents/Cline/Rules/Hooks/PreToolUse
# Universal rule: Never delete package.json
input=$(cat)
tool_name=$(echo "$input" | jq -r '.preToolUse.toolName')
path=$(echo "$input" | jq -r '.preToolUse.parameters.path // ""')

if [[ "$tool_name" == "write_to_file" && "$path" == *"package.json"* ]]; then
  echo '{"cancel": true, "errorMessage": "Global policy: Cannot modify package.json"}'
  exit 0
fi

echo '{"cancel": false}'
```

**Workspace Hook** (applies to specific project):
```bash
#!/usr/bin/env bash
# .clinerules/hooks/PreToolUse
# Project rule: Only TypeScript files
input=$(cat)
tool_name=$(echo "$input" | jq -r '.preToolUse.toolName')
path=$(echo "$input" | jq -r '.preToolUse.parameters.path // ""')

if [[ "$tool_name" == "write_to_file" && "$path" == *.js ]]; then
  echo '{"cancel": true, "errorMessage": "Project rule: Use .ts files only"}'
  exit 0
fi

echo '{"cancel": false}'
```

**All hooks must allow execution for the tool to proceed.** Hooks may execute concurrently.

## Multi-Root Workspaces

If you have multiple workspace roots, you can place hooks in each root's `.clinerules/hooks/` directory. All hooks (global and workspace) may execute concurrently. Their results will be combined:

- **cancel**: If ANY hook returns `true`, execution is blocked
- **contextModification**: All context modifications are concatenated
- **errorMessage**: All error messages are concatenated

**Note:** No execution order is guaranteed between hooks from different directories.

## Troubleshooting

### Hook Not Running
- Ensure the "Enable Hooks" setting is checked
- Verify the hook file is executable (`chmod +x hookname`)
- Check the hook file has no syntax errors
- Look for errors in VSCode's Output panel (Cline channel)

### Hook Timing Out
- Reduce complexity of the hook script
- Avoid expensive operations (network calls, heavy computations)
- Consider moving complex logic to a background process

### Context Not Affecting Behavior
- Remember: context affects FUTURE decisions, not the current tool
- Use PreToolUse for validation (blocking) if you need immediate effect
- Ensure context modifications are clear and actionable
- Check that context isn't being truncated (50KB limit)

## Security Considerations

- Hooks run with the same permissions as VSCode
- Be cautious with hooks from untrusted sources
- Review hook scripts before enabling them
- Consider using `.gitignore` to avoid committing sensitive hook logic
- Hooks can access all workspace files and environment variables

## Best Practices

1. **Keep hooks fast** - Aim for <100ms execution time
2. **Make context actionable** - Be specific about what the AI should do
3. **Use structured prefixes** - Help the AI categorize context
4. **Handle errors gracefully** - Always return valid JSON
5. **Log for debugging** - Keep logs of hook executions for troubleshooting
6. **Test incrementally** - Start with simple hooks and add complexity
7. **Document your hooks** - Add comments explaining the purpose and logic
