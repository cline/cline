### Related Issue

**Issue:** N/A

### Description

This PR introduces telemetry for MCP tool calls to monitor usage, success rates, and errors.

- Adds a new telemetry event 'task.mcp_tool_called'.
- Captures the server name, tool name, and status (started, success, error).
- Integrates telemetry calls into the McpHub to track tool execution lifecycle.

### Test Procedure

Manual testing was performed to ensure that the telemetry events are captured correctly when MCP tools are called.

1.  Connected a local MCP server.
2.  Executed a tool from the server.
3.  Verified that the 'task.mcp_tool_called' event was logged with the correct data (server name, tool name, and status).
4.  Verified that no sensitive argument values were logged.

### Type of Change

-   [x] ✨ New feature (non-breaking change which adds functionality)

### Pre-flight Checklist

-   [x] Changes are limited to a single feature, bugfix or chore (split larger changes into separate PRs)
-   [x] Tests are passing (`npm test`) and code is formatted and linted (`npm run format && npm run lint`)
-   [ ] I have created a changeset using `npm run changeset` (required for user-facing changes)
-   [x] I have reviewed [contributor guidelines](https://github.com/cline/cline/blob/main/CONTRIBUTING.md)

### Screenshots

N/A

### Additional Notes

N/A
