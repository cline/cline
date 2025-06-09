# Testing MCP Real-time Notifications in Cline

## Prerequisites

1. Make sure your MCP server is running:
   ```bash
   cd test-mcp-notifications
   python server.py
   ```

2. Reload VS Code window to apply the changes:
   - Press `Cmd+R` (Mac) or `Ctrl+R` (Windows/Linux)
   - Or use Command Palette: `Developer: Reload Window`

## Test Steps

1. **Check VS Code Developer Tools Console**
   - Open: Help > Toggle Developer Tools
   - Look for `[MCP Debug]` messages showing:
     - "Setting up notification handlers for server: notification-test"
     - "Successfully set notifications/message handler"
     - "Successfully set fallback notification handler"

2. **Use the MCP Tool in Cline**
   - In a new Cline chat, type:
     ```
     Use the MCP tool `start_notifications` from server `notification-test` with arguments `{"count": 5}`
     ```

3. **What You Should See**
   - MCP notifications appearing in the Cline chat interface in real-time
   - Each notification shows as a bell icon with: "MCP Notification: [notification-test] [notification_demo] Notification X/5 sent..."
   - Notifications arrive with random delays between 0.5-5 seconds
   - VS Code notification popups also appear (can be disabled by removing those lines in McpHub.ts)
   - Console logs in Developer Tools showing the raw notification data

## Troubleshooting

If notifications aren't appearing:

1. **Check Server Connection**
   - Look for the notification-test server in Cline's MCP servers list
   - Status should be "connected"

2. **Check Console for Errors**
   - Open VS Code Developer Tools
   - Look for any `[MCP Debug] Error` messages

3. **Verify Server is Running**
   - The Python server should show:
     ```
     INFO:     Starting server on http://127.0.0.1:8000
     INFO:     StreamableHTTP session manager started!
     ```

4. **Check MCP Settings**
   - The notification-test server should be in your MCP settings file
   - Path: `~/Library/Application Support/Code/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json`

## How It Works

1. **Server Side**: Sends notifications using `send_log_message` without `related_request_id`
2. **Client Side**: McpHub registers notification handlers using the MCP SDK's `setNotificationHandler`
3. **Display**: 
   - Notifications are displayed in the Cline chat as they arrive
   - Task checks for pending notifications before and after MCP tool calls
   - VS Code popups also appear (optional)
4. **Transport**: Works with streamableHTTP transport (and should work with stdio/SSE too)

## Success Indicators

✅ Notifications appear in Cline chat with bell icon
✅ VS Code popups appear in real-time (optional)
✅ Console shows `[MCP Notification]` logs
✅ Notifications arrive independently with delays
✅ Tool completes after all notifications sent
