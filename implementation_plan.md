# Implementation Plan

[Overview]
This document outlines the plan to add telemetry for MCP tool calls, capturing events before and after execution with status, server name, and tool name.

The goal is to gain insight into MCP tool usage, including frequency, success rates, and errors, without compromising user privacy by logging arguments. This will help in monitoring the health and performance of MCP integrations.

[Types]
No new types are required for this implementation.

[Files]
This implementation will modify two existing files to add the necessary telemetry hooks.

-   **`src/services/posthog/telemetry/TelemetryService.ts`**: This file will be modified to add a new telemetry event and a corresponding capture method for MCP tool calls.
-   **`src/services/mcp/McpHub.ts`**: This file will be modified to call the new telemetry capture method before and after a tool is called, including the status of the call.

[Functions]
This implementation will add one new function and modify an existing one.

-   **New Function**:
    -   **Name**: `captureMcpToolCall`
    -   **File Path**: `src/services/posthog/telemetry/TelemetryService.ts`
    -   **Purpose**: To capture telemetry data related to MCP tool calls, including the server name, tool name, status (started, success, error), and any error message.
-   **Modified Function**:
    -   **Name**: `callTool`
    -   **File Path**: `src/services/mcp/McpHub.ts`
    -   **Changes**: This function will be updated to call `captureMcpToolCall` before it attempts to execute a tool and again after the execution is complete, capturing the success or failure status.

[Classes]
No new classes will be added. The following classes will be modified:

-   **`TelemetryService`**: A new method `captureMcpToolCall` will be added.
-   **`McpHub`**: The `callTool` method will be modified to include telemetry calls.

[Dependencies]
No new dependencies are required for this implementation.

[Testing]
No new tests will be added as this change is related to telemetry and does not alter the core functionality of the tools. Manual verification will be sufficient.

[Implementation Order]
The implementation will be carried out in the following order to ensure a smooth integration.

1.  **Add Telemetry Event**: Add a new event constant for MCP tool calls in `TelemetryService.EVENTS`.
2.  **Implement Capture Method**: Implement the `captureMcpToolCall` method in `TelemetryService.ts`.
3.  **Integrate Telemetry in McpHub**: Modify the `callTool` method in `McpHub.ts` to call the new telemetry capture method at the start and end of the tool execution, passing the appropriate status and data.
