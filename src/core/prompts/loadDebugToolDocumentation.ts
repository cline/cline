export async function loadDebugToolDocumentation() {
	return (
		`## set_breakpoint
Description: Sets a breakpoint at a specific line in a file. This tool allows you to place debugging breakpoints in your code, which will pause execution when reached during a debug session.
Parameters:
- file_path: (required) Path to the file where the breakpoint should be set (relative to the current working directory)
- line: (required) Line number where the breakpoint should be set (1-based)
Usage:
<set_breakpoint>
<file_path>src/main.js</file_path>
<line>42</line>
</set_breakpoint>

## list_breakpoints
Description: Gets a list of all currently set breakpoints in the workspace, with optional filtering by file path. This tool helps you see where all breakpoints are currently placed.
Parameters:
- file_path: (optional) Path to filter breakpoints by file
Usage:
<list_breakpoints>
<file_path>src/main.js</file_path>
</list_breakpoints>
` +
		// ## list_debug_sessions
		// Description: Lists all active debug sessions in the VSCode workspace. This tool helps you see what debug sessions are currently running and their IDs.
		// Parameters: None
		// Usage:
		// <list_debug_sessions>
		// </list_debug_sessions>

		` 
## start_debugging_and_wait_for_stop
Description: Starts a new debug session using either a named configuration from .vscode/launch.json or a direct configuration object, then waits until a breakpoint is hit before returning. This tool provides detailed debug information including call stack and variables when the debugger stops.
Parameters:
- nameOrConfiguration: (required) Either the name of a debug configuration from .vscode/launch.json (string) or a debug configuration object (must include type, request, and name properties)
- variable_filter: (optional) Array of variable names to filter. When provided, only variables matching these names will be included in the response.
- timeout_seconds: (optional) Maximum time in seconds to wait for a breakpoint to be hit. Defaults to 60 seconds.
- breakpointConfig: (optional) Configuration for managing breakpoints when starting the debug session
  - clearExisting: (optional) If true, disables all existing breakpoints before adding new ones
  - breakpoints: (optional) Array of breakpoints to set before starting the debug session, each with:
    - path: Path to the file where the breakpoint should be set
    - line: Line number where the breakpoint should be set (1-based)
Usage:
<start_debugging_and_wait_for_stop>
<nameOrConfiguration>Debug Current File</nameOrConfiguration>
<variable_filter>["result", "myVariable"]</variable_filter>
<breakpointConfig>
{
  "clearExisting": true,
  "breakpoints": [
    {"path": "src/main.js", "line": 10},
    {"path": "src/utils.js", "line": 25}
  ]
}
</breakpointConfig>
</start_debugging_and_wait_for_stop>

Or with a configuration object:
<start_debugging_and_wait_for_stop>
<nameOrConfiguration>
{
  "type": "node",
  "request": "launch",
  "name": "Debug Current File",
  "program": "\${fullFilePath}"
}
</nameOrConfiguration>
</start_debugging_and_wait_for_stop>

## stop_debug_session
Description: Stops debug sessions that match a provided session name. This tool allows you to end debugging sessions when you're finished.
Parameters:
- session_name: (required) Name of the debug session(s) to stop
Usage:
<stop_debug_session>
<session_name>Debug Current File</session_name>
</stop_debug_session>

## resume_debug_session
Description: Resumes execution of a debug session that has been paused at a breakpoint. This tool allows you to continue program execution after hitting a breakpoint.
Parameters:
- session_id: (required) ID of the debug session to resume
- breakpointConfig: (optional) Configuration for managing breakpoints when resuming the debug session
  - clearExisting: (optional) If true, disables all existing breakpoints before resuming
  - breakpoints: (optional) Array of breakpoints to set before resuming, each with:
    - path: Path to the file where the breakpoint should be set
    - line: Line number where the breakpoint should be set (1-based)
Usage:
<resume_debug_session>
<session_id>1</session_id>
<breakpointConfig>
{
  "clearExisting": true,
  "breakpoints": [
    {"path": "src/main.js", "line": 20}
  ]
}
</breakpointConfig>
</resume_debug_session>
`
	)
}
