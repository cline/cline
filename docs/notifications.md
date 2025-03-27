# Notification System

The Notification System allows Cline to display important messages, suggestions, and alerts to users directly within the extension interface.

## Overview

Notifications are displayed in a panel accessible from the task header. They can come from various sources, including:

- MCP servers providing code suggestions
- System alerts about important events
- Task-related information and tips
- External MCP tools like Claude Desktop

Notifications are categorized by type (info, warning, tip, task) and priority (high, medium, low).

## How to Use

1. **Accessing Notifications**: Click the bell icon in the task header to open the notification panel.
2. **Reading Notifications**: Unread notifications are highlighted. Click on a notification to expand its content.
3. **Managing Notifications**:
   - **Send to Chat**: Send the notification content directly to the chat as a message
   - **Dismiss**: Move a notification to the "Dismissed" section
   - **Restore**: Bring a dismissed notification back to the active list

## Integration with External MCP Tools

The Notification System serves as a powerful bridge between Cline and external MCP tools like Claude Desktop:

- External MCP tools can send messages, suggestions, and advice to your active Cline conversations
- These messages appear as notifications that you can review and optionally send to the chat
- This creates a seamless workflow where you can use Claude Desktop for research and planning ($20/month subscription), then send targeted advice to Cline
- The integration acts like an "external plan mode," allowing you to leverage the strengths of both tools while managing costs effectively

This integration is implemented using the [cline-mcp-tools](https://github.com/anthonyjj89/cline-mcp-tools) MCP server, which has been specifically tested and verified with Claude Desktop. The MCP server provides a `send_external_advice` tool that allows Claude Desktop to send notifications to Cline.

For example, you can use Claude Desktop with its MCP tools (like Brave Search) to research a complex problem, then send the solution directly to your Cline conversation as a notification.

## Machine-Actionable Notifications

Some notifications are "machine-actionable," meaning they contain structured data that can be used to take specific actions:

- **Code Suggestions**: Recommendations for code changes with before/after examples
- **File References**: Links to relevant files that can be opened directly
- **Context-Aware Advice**: Suggestions based on your current task context

## Technical Implementation

Notifications are stored as JSON files in the task's external advice directory:

```
<global-storage-path>/tasks/<task-id>/external_advice/
```

Dismissed notifications are moved to:

```
<global-storage-path>/tasks/<task-id>/external_advice/Dismissed/
```

The notification system uses a polling mechanism to check for new notifications every few seconds.

## Creating Notifications (for MCP Developers)

MCP servers can create notifications by writing JSON files to the external advice directory. The reference implementation for this is the [cline-mcp-tools](https://github.com/anthonyjj89/cline-mcp-tools) MCP server, which provides a `send_external_advice` tool.

The notification file format is:

```json
{
  "id": "unique-notification-id",
  "title": "Notification Title",
  "content": "Detailed notification content...",
  "type": "info|warning|tip|task",
  "priority": "high|medium|low",
  "timestamp": 1648123456789,
  "read": false,
  "dismissed": false,
  "expiresAt": 1648123456789,
  "relatedFiles": ["/path/to/file1.js", "/path/to/file2.js"],
  "machineData": {
    "actionType": "code-suggestion",
    "context": "Context information",
    "suggestions": [
      {
        "file": "/path/to/file.js",
        "location": { "line": 42, "column": 10 },
        "explanation": "Why this change is suggested",
        "currentCode": "const x = 1;",
        "suggestedCode": "const x = 2;"
      }
    ]
  }
}
```

## Configuration

The notification system respects the `cline.ui.showHeaderControls` setting. When this setting is disabled, the notification bell will not be displayed.
