# External MCP Tools Integration

## Problem Statement

Currently, users who want to leverage both Cline and Claude Desktop have to switch between applications and manually transfer information. This leads to:

1. Increased costs as each message sent to Cline incurs a per-message charge ($0.02-$0.05)
2. Workflow disruption when switching between tools
3. Inability to leverage the strengths of both platforms in a seamless manner

## Solution

This PR introduces two key features that enable seamless integration between Cline and external MCP tools like Claude Desktop:

1. **Active Conversation Marking**: Users can mark conversations as "Active A" or "Active B", allowing external MCP tools to detect and access these conversations.
2. **Notification System Bridge**: External MCP tools can send messages, suggestions, and advice to active Cline conversations through the notification system.

This creates a cost-effective workflow where users can:
- Use Claude Desktop for research and planning (with its $20/month subscription)
- Send targeted advice and solutions to Cline through the notification system
- Leverage Cline's powerful code editing capabilities without incurring per-message costs for research and planning

## Implementation Details

The implementation builds on existing features:

1. **Active Conversation Feature**:
   - Enhanced to expose conversation context to external MCP tools
   - Maintains the existing UI with wave icon in the task header
   - Uses the same storage mechanism at `~/Library/Application Support/Code/User/globalStorage/saoudrizwan.claude-dev/active_tasks.json`

2. **Notification System**:
   - Extended to receive messages from external MCP tools
   - Maintains the existing UI with bell icon in the task header
   - Uses the same storage mechanism in the task's external advice directory

3. **MCP Server Integration**:
   - Implemented using the [cline-mcp-tools](https://github.com/anthonyjj89/cline-mcp-tools) MCP server
   - Currently tested and verified with Claude Desktop only
   - Provides the `send_external_advice` tool for sending notifications from Claude Desktop to Cline

## User Experience

From the user's perspective, the workflow is:

1. Mark a Cline conversation as "Active A" or "Active B" using the wave icon
2. Use Claude Desktop to research, plan, or solve complex problems
3. Send targeted advice from Claude Desktop to the active Cline conversation
4. Review notifications in Cline and send them to the chat with a single click

This creates a seamless "external plan mode" experience, where Claude Desktop acts as the planning tool and Cline handles the implementation.

## Documentation Updates

- Updated `docs/active-conversation.md` to document the integration with external MCP tools
- Updated `docs/notifications.md` to explain how notifications can be used as a bridge between tools
- Added a "Proposed Features" section to `CHANGELOG.md` to highlight these new capabilities

## Future Enhancements

- Extend testing and support to other external MCP tools beyond Claude Desktop

## Pre-Submission Checks

All required pre-submission checks have been completed:
- ✅ Dependencies installed (`npm run install:all`)
- ✅ Tests passing (`npm run test`)
- ✅ Code style verified (`npm run lint`)
- ✅ Code formatted (`npm run format:fix`)
- ✅ Changeset created (`npm run changeset`)
- ✅ Build artifacts removed
- ✅ Documentation updated

## Screenshots

*Screenshots of the feature in action would be included here in the actual PR*
