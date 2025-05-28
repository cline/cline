# Debugging Integration

## Overview

The debugging integration in Cline provides functionality for setting breakpoints, managing debug sessions, and interacting with VSCode's debugging capabilities. This document explains how the debugging integration works and how its different components interact with each other.

## Component Overview

The debugging integration consists of several key components:

1. **BreakpointManager**: Manages breakpoints in the VSCode workspace.
2. **DebugSessionManager**: Manages debug sessions in VSCode.
3. **Debug Tools**: A set of tools that expose debugging functionality to Cline.
4. **FocusEditor**: Provides functionality to open files in the editor and navigate to specific positions.

## Architecture

The debugging integration follows a layered architecture:

1. **Core Layer**: The core layer registers the debugging tools in the `toolUseNames` and `toolParamNames` arrays.
   - File: `src/core/assistant-message/index.ts`
   - Adds tool names like `set_breakpoint`, `resume_debug_session`, etc.
   - Adds parameter names like `file_path`, `line`, `session_id`, etc.

2. **Integration Layer**: The integration layer implements the debugging functionality.
   - Files: `src/integrations/debug/*.ts`
   - Provides classes like `BreakpointManager` and `DebugSessionManager`
   - Implements functions for setting breakpoints, managing debug sessions, etc.

3. **Tool Layer**: The tool layer exposes the debugging functionality as tools.
   - File: `src/integrations/tools.ts`
   - Exports functions like `setBreakpoint`, `startDebugSession`, etc.

4. **System Prompt Layer**: The system prompt layer provides documentation for the debugging tools.
   - File: `src/core/prompts/debug_tools.ts`
   - Documents the syntax and parameters for each debugging tool.

## Breakpoint Event Handling

The debugging integration uses VSCode's event system to track when breakpoints are hit:

1. The `DebugSessionManager` initializes event listeners when the extension is loaded.
2. When a debug session stops at a breakpoint, VSCode emits a `stopped` event.
3. The `DebugSessionManager` captures this event and emits a `breakpointHit` event.
4. Tools like `waitForBreakpointHit` and `startDebugSession` (with `waitForStop: true`) can wait for this event.

## Debug Session Management

Debug sessions are managed through the `DebugSessionManager`:

1. The `startDebugSession` tool starts a new debug session with the provided configuration.
2. The `stopDebugSession` tool stops debug sessions that match a provided session name.
3. The `resumeDebugSession` tool resumes a paused debug session.
4. The `restartDebugSession` tool restarts a debug session.

## Breakpoint Management

Breakpoints are managed through the `BreakpointManager`:

1. The `setBreakpoint` tool sets a breakpoint at a specific line in a file.
2. The `listBreakpoints` tool lists all breakpoints in the workspace, optionally filtered by file path.

## Integration with VSCode

The debugging integration leverages VSCode's Debug API:

1. `vscode.debug.startDebugging()` to start debug sessions
2. `vscode.debug.stopDebugging()` to stop debug sessions
3. `vscode.debug.addBreakpoints()` to add breakpoints
4. `vscode.debug.breakpoints` to get all breakpoints
5. `vscode.debug.onDidStartDebugSession` to track new debug sessions
6. `vscode.debug.onDidTerminateDebugSession` to track terminated debug sessions
7. `vscode.debug.registerDebugAdapterTrackerFactory` to track debug events

## Usage Examples

### Setting a Breakpoint

```
<set_breakpoint>
<file_path>src/main.js</file_path>
<line>42</line>
</set_breakpoint>
```

### Starting a Debug Session

```
<start_debug_session>
<configuration>
{
  "type": "node",
  "request": "launch",
  "name": "Debug Current File",
  "program": "${file}"
}
</configuration>
</start_debug_session>
```

## Error Handling

The debugging integration follows a consistent error handling pattern:

1. Each tool validates its parameters and returns appropriate error messages if they are invalid.
2. Each tool catches exceptions and returns informative error messages.
3. Error messages include details about what went wrong and suggestions for how to fix the issue. 