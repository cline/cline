# Cline Hooks Documentation

## Overview

Cline hooks allow you to execute custom scripts at specific points in the agentic workflow. Hooks are placed in the `.clinerules/hooks/` directory and run automatically when enabled.

## Enabling Hooks

1. Open Cline settings in VSCode
2. Navigate to the Feature Settings section
3. Check the "Enable Hooks" checkbox
4. Hooks must be executable files (on Unix/Linux/macOS use `chmod +x hookname`)

## Available Hooks

### PreToolUse Hook
- **When**: Runs BEFORE a tool is executed
- **Purpose**: Validate parameters, block execution, or add context
- **File**: `.clinerules/hooks/PreToolUse` (Unix/Linux/macOS) or `.clinerules/hooks/PreToolUse.bat/.cmd/.exe` (Windows)

### PostToolUse Hook
- **When**: Runs AFTER a tool completes
- **Purpose**: Observe results, track patterns, or add context
- **File**: `.clinerules/hooks/PostToolUse` (Unix/Linux/macOS) or `.clinerules/hooks/PostToolUse.bat/.cmd/.exe` (Windows)

## Platform-Specific Guidance

### Windows Hooks

Windows hooks use different file extensions and syntax than Unix hooks. Cline automatically searches for hooks using your system's `PATHEXT` environment variable (typically `.COM;.EXE;.BAT;.CMD;.VBS;.JS;.WSF;.MSC`).

**Recommended approach for Windows:**
- Use `.cmd` or `.bat` batch files (most compatible)
- See `PreToolUse.example.cmd` and `PostToolUse.example.cmd` for simple examples
- See `PreToolUse.advanced.example.cmd` for PowerShell-based JSON parsing

**Simple Windows Hook Example:**
```batch
@echo off
REM Always allow execution with context
echo {"shouldContinue": true, "contextModification": "WORKSPACE_RULES: TypeScript project"}
```

**Advanced Windows Hook with Input Parsing:**
```batch
@echo off
setlocal enabledelayedexpansion

REM Read stdin using PowerShell
for /f "usebackq delims=" %%i in (`powershell -Command "[Console]::In.ReadToEnd()"`) do set "INPUT=%%i"

REM Parse and process JSON
powershell -Command ^
  "$json = '%INPUT%' | ConvertFrom-Json; ^
   $output = @{shouldContinue = $true}; ^
   $output | ConvertTo-Json -Compress"
```

**Tips for Windows:**
- Batch files don't require `chmod +x` - they're executable by default
- Use `REM` for comments instead of `#`
- PowerShell is available on all modern Windows systems
- For complex logic, consider PowerShell scripts (`.ps1`) or compiled executables (`.exe`)

### Unix/Linux/macOS Hooks

Unix hooks are shell scripts without file extensions:
- Must be executable: `chmod +x PreToolUse`
- Must include shebang: `#!/usr/bin/env bash` or `#!/usr/bin/env node`
- See `PreToolUse.example` and `PostToolUse.example` for bash examples

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
  "hookName": "PreToolUse" | "PostToolUse",
  "timestamp": "string",
  "taskId": "string",
  "workspaceRoots": ["string"],
  "userId": "string",
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
  "shouldContinue": boolean,           // Required: Allow or block execution
  "contextModification": "string",      // Optional: Context for future tool uses
  "errorMessage": "string"             // Optional: Error details if blocking
}
```

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
  "shouldContinue": true,
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
  "shouldContinue": false,
  "errorMessage": "Cannot create .js files in TypeScript project",
  "contextModification": "WORKSPACE_RULES: Use .ts/.tsx extensions only"
}
EOF
  exit 0
fi

echo '{"shouldContinue": true}'
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
  "shouldContinue": true,
  "contextModification": "FILE_OPERATIONS: Created '$path'. Maintain consistency with this file's patterns in future operations."
}
EOF
else
  echo '{"shouldContinue": true}'
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
  "shouldContinue": true,
  "contextModification": "PERFORMANCE: Tool '$tool_name' took ${execution_time}ms. Consider optimizing future similar operations."
}
EOF
else
  echo '{"shouldContinue": true}'
fi
```

### 4. Logging and Telemetry

```bash
#!/usr/bin/env bash
input=$(cat)

# Log to file
echo "$input" >> ~/.cline/hook-logs/tool-usage.jsonl

# Allow execution
echo '{"shouldContinue": true}'
```

## Multi-Root Workspaces

If you have multiple workspace roots, you can place hooks in each root's `.clinerules/hooks/` directory. All hooks will run and their results will be combined:

- **shouldContinue**: If ANY hook returns false, execution is blocked
- **contextModification**: All context modifications are concatenated
- **errorMessage**: All error messages are concatenated

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
