# Cline Hook Configuration Guide

This guide explains how to configure hooks for Cline to integrate with agent-manager and other monitoring systems.

## Overview

Cline uses the same hook system as Claude, allowing external tools to monitor and control its behavior. Hooks are configured via a `settings.json` file in the project's `.cline` directory.

## Configuration Locations

Cline supports both global and project-level hook configurations:

### Global Configuration
```
~/.cline/settings.json
```
Global hooks apply to all projects and are useful for organization-wide monitoring or policies.

### Project Configuration
```
<project_root>/.cline/settings.json
```
Project-specific hooks apply only to the current project and can extend or override global hooks.

### Configuration Precedence
- Both global and project configurations are loaded if they exist
- Hook arrays are merged: global hooks run first, then project hooks
- Settings are merged with project settings taking precedence over global settings

## Configuration Structure

The `settings.json` file follows Claude's hook configuration format:

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
    }],
    "PostToolUse": [{
      "matcher": "*",
      "hooks": [{
        "type": "command",
        "command": "npx @principal-ai/agent-hooks cline-hook --port 3043",
        "timeout": 60
      }]
    }],
    "UserPromptSubmit": [{
      "matcher": "*",
      "hooks": [{
        "type": "command",
        "command": "npx @principal-ai/agent-hooks cline-hook --port 3043",
        "timeout": 60
      }]
    }],
    "Stop": [{
      "matcher": "*",
      "hooks": [{
        "type": "command",
        "command": "npx @principal-ai/agent-hooks cline-hook --port 3043",
        "timeout": 60
      }]
    }],
    "SessionStart": [{
      "matcher": "*",
      "hooks": [{
        "type": "command",
        "command": "npx @principal-ai/agent-hooks cline-hook --port 3043",
        "timeout": 60
      }]
    }],
    "SessionEnd": [{
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

## Supported Hook Events

Cline supports the following hook events:

### 1. PreToolUse
- **When**: Before executing any tool
- **Capabilities**: Can approve/deny tool execution, modify tool input
- **Event Data**: Tool name and input parameters

### 2. PostToolUse
- **When**: After a tool completes execution
- **Capabilities**: Can modify tool output before it's used
- **Event Data**: Tool name, input, and output

### 3. UserPromptSubmit
- **When**: When user submits a message
- **Capabilities**: Can approve/deny or modify the prompt
- **Event Data**: User's prompt text

### 4. Stop
- **When**: When task is aborted or stopped
- **Capabilities**: Cleanup and logging
- **Event Data**: Stop context

### 5. SessionStart
- **When**: When starting a new task or resuming
- **Capabilities**: Initialize monitoring, inject context
- **Event Data**: Source ("startup", "resume", "clear")

### 6. SessionEnd
- **When**: When session ends
- **Capabilities**: Final cleanup and reporting
- **Event Data**: Session end context

### 7. SubagentStop (TODO)
- **When**: When a subagent completes
- **Not yet implemented in Cline**

### 8. PreCompact (TODO)
- **When**: Before context compaction
- **Not yet implemented in Cline**

### 9. Notification (TODO)
- **When**: Various notification scenarios
- **Not yet implemented in Cline**

## Hook Configuration Fields

### matcher
- Pattern to match against tool names (for PreToolUse/PostToolUse)
- Use `"*"` to match all tools
- Use specific tool names like `"Read"`, `"Write"`, `"Execute"`

### command
- Shell command to execute for the hook
- Receives event data as JSON on stdin
- Must output JSON response on stdout

### timeout
- Maximum execution time in seconds (default: 60)
- Hook is cancelled if it exceeds timeout

## Hook Response Format

Hooks must output JSON to stdout:

### PreToolUse Response
```json
{
  "approve": true,
  "message": "Optional message to display",
  "modifiedInput": { /* Optional modified tool parameters */ },
  "additionalContext": ["Optional context strings"]
}
```

### PostToolUse Response
```json
{
  "approve": true,
  "message": "Optional message",
  "modifiedOutput": { /* Optional modified tool result */ },
  "additionalContext": ["Optional context strings"]
}
```

### UserPromptSubmit Response
```json
{
  "approve": true,
  "message": "Optional message",
  "modifiedInput": "Optional modified prompt text",
  "additionalContext": ["Optional context strings"]
}
```

## Global vs Project Configuration Examples

### Global Configuration Use Cases

1. **Organization-wide monitoring**: Set up hooks that track all Cline usage across all projects
2. **Security policies**: Enforce security checks before certain tool executions
3. **Compliance logging**: Maintain audit logs for all AI interactions

Example global configuration (`~/.cline/settings.json`):
```json
{
  "hooks": {
    "PreToolUse": [{
      "matcher": "Execute",
      "hooks": [{
        "type": "command",
        "command": "/usr/local/bin/security-check",
        "timeout": 10
      }]
    }],
    "SessionStart": [{
      "matcher": "*",
      "hooks": [{
        "type": "command",
        "command": "/usr/local/bin/audit-logger --event=session-start",
        "timeout": 5
      }]
    }]
  }
}
```

### Project Configuration Use Cases

1. **Project-specific tooling**: Integrate with project-specific build or test systems
2. **Custom validations**: Add project-specific checks for file modifications
3. **Team notifications**: Alert team members about certain operations

Example project configuration (`<project_root>/.cline/settings.json`):
```json
{
  "hooks": {
    "PreToolUse": [{
      "matcher": "Write",
      "hooks": [{
        "type": "command",
        "command": "./scripts/validate-write.sh",
        "timeout": 15
      }]
    }],
    "PostToolUse": [{
      "matcher": "Execute",
      "hooks": [{
        "type": "command",
        "command": "./scripts/notify-team.sh",
        "timeout": 5
      }]
    }]
  },
  "settings": {
    "defaultTimeout": 30,
    "parallel": true
  }
}
```

### Combined Effect

When both global and project configurations exist:
- Global `PreToolUse` hooks for "Execute" run first
- Then project `PreToolUse` hooks for "Write" run
- Settings from project override global settings (defaultTimeout: 30, parallel: true)

## Integration with agent-manager

To configure Cline hooks using agent-manager:

### 1. Manual Configuration
Create `.cline/settings.json` in your project directory with the configuration above.

### 2. Using agent-manager CLI (Future)
```bash
# Enable hooks for Cline (not yet implemented)
npx @principal-ai/agent-manager cline enable-hooks --port 3043

# Disable hooks
npx @principal-ai/agent-manager cline disable-hooks

# Check status
npx @principal-ai/agent-manager cline status
```

### 3. Using agent-hooks Package
The `@principal-ai/agent-hooks` package provides a pre-built hook implementation:

```bash
# Install globally or as dev dependency
npm install -g @principal-ai/agent-hooks

# Run the hook server
npx @principal-ai/agent-hooks cline-hook --port 3043
```

## Tool Name Mapping

Cline tools are mapped to Claude-compatible names:

| Cline Tool | Claude Name |
|------------|-------------|
| FILE_READ | Read |
| FILE_NEW | Write |
| FILE_EDIT | Write |
| NEW_RULE | Write |
| LIST_FILES | ListFiles |
| LIST_CODE_DEFINITIONS | ListCodeDefinitions |
| SEARCH_FILES | Search |
| BROWSER_ACTION | Browser |
| WEB_FETCH | WebFetch |
| ASK_FOLLOWUP | AskFollowup |
| ASK_CONFIRMATION | AskConfirmation |
| USE_MCP | UseMcp |
| ACCESS_MCP_RESOURCE | AccessMcpResource |
| LOAD_MCP_DOCUMENTATION | LoadMcpDocumentation |
| EXECUTE_COMMAND | Execute |
| RESPONSE_WITH_PLAN | PlanResponse |
| NEW_TASK | NewTask |
| ATTEMPT_COMPLETION | AttemptCompletion |
| CONDENSE | Condense |
| SUMMARIZE_TASK | SummarizeTask |
| REPORT_BUG | ReportBug |

## Example Hook Implementation

Here's a simple Node.js hook that logs all tool usage:

```javascript
#!/usr/bin/env node

const fs = require('fs');

// Read event from stdin
let input = '';
process.stdin.on('data', chunk => input += chunk);
process.stdin.on('end', () => {
  try {
    const event = JSON.parse(input);

    // Log the event
    fs.appendFileSync('/tmp/cline-hooks.log',
      `${new Date().toISOString()} - ${event.hook_event_name}: ${JSON.stringify(event)}\n`
    );

    // Always approve with a message
    const response = {
      approve: true,
      message: `Logged ${event.hook_event_name} event`
    };

    // Output response
    console.log(JSON.stringify(response));
  } catch (error) {
    // On error, approve silently
    console.log(JSON.stringify({ approve: true }));
  }
});
```

## Testing Hooks

To test your hook configuration:

1. Create a test hook script:
```bash
#!/bin/bash
echo '{"approve": true, "message": "Test hook executed"}'
```

2. Make it executable:
```bash
chmod +x test-hook.sh
```

3. Add to `.cline/settings.json`:
```json
{
  "hooks": {
    "PreToolUse": [{
      "matcher": "*",
      "hooks": [{
        "type": "command",
        "command": "/path/to/test-hook.sh",
        "timeout": 5
      }]
    }]
  }
}
```

4. Run Cline and verify the hook executes when tools are used.

## Troubleshooting

### Hooks Not Executing
- Ensure `.cline/settings.json` exists in project root
- Check file permissions on hook scripts
- Verify JSON syntax in settings.json
- Check hook command paths are absolute or in PATH

### Hook Timeouts
- Increase timeout value in configuration
- Ensure hook scripts exit promptly
- Check for blocking I/O in hook implementation

### Permission Denied
- Hook scripts must be executable (`chmod +x`)
- Ensure Cline process has permission to execute hooks

## Security Considerations

- **Never put sensitive data in hook commands**
- **Validate all hook inputs** - Event data comes from Cline
- **Use absolute paths** for hook scripts to prevent PATH injection
- **Set appropriate timeouts** to prevent hanging
- **Log hook executions** for audit purposes

## Future Enhancements

The following features are planned:

1. **Hook Templates**: Pre-built hooks for common scenarios
2. **Hook Validation**: Validate hook configuration on load
3. **Performance Metrics**: Track hook execution times
4. **Additional Events**: SubagentStop, PreCompact, Notification
5. **Hook Priority System**: Control execution order when merging global and project hooks
6. **Hook Disable Flags**: Allow projects to selectively disable specific global hooks