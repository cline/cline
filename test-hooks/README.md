# Cline Hook Testing Guide

This directory contains test scripts and configurations for validating Cline's hook integration.

## Quick Start

### 1. Enable Hooks for Testing

The test configuration is already set up in `.cline/settings.json`. It configures all hook events to use the simple logger script.

### 2. Test Hook Events

Run the test script to validate all hook events:

```bash
node test-hooks/test-hook-events.js
```

This will test all 6 implemented hook events and verify their responses.

### 3. Test with Actual Cline

To test hooks with the actual Cline extension:

1. Ensure `.cline/settings.json` exists with the test configuration
2. Open VS Code in the Cline project directory
3. Start a new Cline task
4. Check the log file at `/tmp/cline-hook-test.log` to see captured events

## Files

- `simple-logger.js` - A basic hook implementation that logs all events
- `test-hook-events.js` - Test script to validate hook processing
- `README.md` - This file

## Testing with agent-manager

To test integration with agent-manager:

### Option 1: Direct Command Configuration

Update `.cline/settings.json` to use agent-manager's hook:

```json
{
  "hooks": {
    "PreToolUse": [{
      "matcher": "*",
      "hooks": [{
        "type": "command",
        "command": "npx @principal-ai/agent-hooks cline-hook --port 3043",
        "timeout": 60
      }]
    }]
  }
}
```

### Option 2: Using cline-hook.ts

Once the cline-hook implementation is added to agent-hooks:

```bash
# Install agent-hooks
npm install -g @principal-ai/agent-hooks

# Run the hook server
npx @principal-ai/agent-hooks cline-hook --port 3043
```

## Expected Behavior

When hooks are properly configured:

1. **PreToolUse**: Hook executes before every tool call, can deny or modify
2. **PostToolUse**: Hook executes after tool completion, can modify output
3. **UserPromptSubmit**: Hook validates user messages before processing
4. **SessionStart**: Hook initializes monitoring when tasks begin
5. **Stop**: Hook performs cleanup when tasks are aborted
6. **SessionEnd**: Hook finalizes when sessions end

## Troubleshooting

### Hooks Not Executing
- Check `.cline/settings.json` exists and is valid JSON
- Verify hook script paths are absolute
- Ensure scripts are executable (`chmod +x`)

### Hook Errors
- Check `/tmp/cline-hook-test.log` for error messages
- Verify Node.js is in PATH
- Check hook script syntax

### Testing Individual Events

You can test individual events manually:

```bash
# Test PreToolUse
echo '{"hook_event_name":"PreToolUse","tool_name":"Read","tool_input":{"path":"test.txt"}}' | node test-hooks/simple-logger.js

# Test UserPromptSubmit
echo '{"hook_event_name":"UserPromptSubmit","prompt":"Test message"}' | node test-hooks/simple-logger.js
```

## Integration Checklist

- [ ] Hooks execute for all configured events
- [ ] Hook responses are properly handled
- [ ] Tool execution can be denied by hooks
- [ ] Tool input/output can be modified
- [ ] User prompts can be validated/modified
- [ ] Session lifecycle hooks fire correctly
- [ ] Timeout handling works (60s default)
- [ ] Error handling doesn't crash Cline

## Next Steps

1. **Production Hook**: Implement actual monitoring/control logic
2. **Performance Testing**: Validate hook overhead is acceptable
3. **Security Testing**: Ensure hooks can't bypass security
4. **Integration Testing**: Test with full agent-manager stack