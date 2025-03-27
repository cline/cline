# Active Conversation Feature

The Active Conversation feature allows you to mark specific conversations as "active" so they can be easily referenced across different parts of your workflow.

> **Note:** This feature is part of the task header controls, along with the [Notification System](./notifications.md). Both can be toggled using the `cline.ui.showHeaderControls` setting.

## Overview

Active conversations are marked with a special status indicator in the task header. There are two active conversation slots available:

- **Active A** (green): Your primary active conversation
- **Active B** (blue): Your secondary active conversation

## How to Use

1. To toggle a conversation's active status, click the wave icon in the task header.
2. The status cycles through: Inactive → Active A → Active B → Inactive.
3. Only one conversation can be "Active A" at a time. If you mark a new conversation as "Active A", any previous "Active A" conversation will be demoted.

## Integration with External MCP Tools

The Active Conversation feature enables powerful integration with external MCP tools, such as Claude Desktop:

- When a conversation is marked as "Active A" or "Active B", external MCP tools can detect and access this conversation.
- This allows external tools to read the conversation context, providing an "over-the-shoulder manager" experience.
- External MCP tools can analyze both the conversation and your workspace files to provide targeted assistance.
- This integration creates a seamless workflow between Cline and other AI assistants, allowing you to leverage the strengths of each.

This integration is implemented using the [cline-mcp-tools](https://github.com/anthonyjj89/cline-mcp-tools) MCP server, which has been specifically tested and verified with Claude Desktop. The MCP server can detect which conversations are marked as active and interact with them.

For example, you can use Claude Desktop (with its $20/month subscription) to perform research and planning, then send targeted advice to your active Cline conversation through the notification system.

## Technical Implementation

The active conversation status is stored in a JSON file at:
- `~/Library/Application Support/Code/User/globalStorage/saoudrizwan.claude-dev/active_tasks.json`

The file structure is:

```json
{
  "activeTasks": [
    {
      "id": "task-id-1",
      "label": "A",
      "lastActivated": 1648123456789,
      "source": "cline",
      "extensionType": "cline"
    },
    {
      "id": "task-id-2",
      "label": "B",
      "lastActivated": 1648123456790,
      "source": "cline",
      "extensionType": "cline"
    }
  ]
}
```

## Use Cases

- Mark a conversation as "Active A" when it contains important context you need to reference frequently
- Use "Active B" for a secondary conversation that complements your primary work
- Toggle between active statuses to organize your workflow when working on multiple related tasks
- Enable external MCP tools to monitor and provide assistance for specific conversations
- Create a cost-effective workflow by using Claude Desktop for research and planning, then sending targeted advice to Cline

## Troubleshooting

If the active conversation status isn't updating:
1. Check that the extension has write permissions to the globalStorage directory
2. Restart VS Code to refresh the extension state
3. Ensure the task ID exists in your task history
