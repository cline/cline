# MCP Real-time Notifications Test

This is a test MCP server that demonstrates real-time notifications in Cline.

## Setup

1. Install dependencies:
```bash
pip install -r requirements.txt
```

2. Run the server:
```bash
python server.py
```

3. Add the server to Cline's MCP settings:
   - Open the Cline MCP settings file (you can find the path in VS Code)
   - Add this configuration:

```json
{
  "mcpServers": {
    "notification-test": {
      "type": "streamableHttp",
      "url": "http://127.0.0.1:8000/mcp",
      "disabled": false,
      "autoApprove": []
    }
  }
}
```

## Testing

1. Make sure the server is running (you should see "Starting server on http://127.0.0.1:8000")
2. In Cline, use the MCP tool:
   - Server: `notification-test`
   - Tool: `start_notifications`
   - Arguments: `{"count": 5}`

3. You should see VS Code notification popups appearing in real-time as the server sends them!

## How it works

- The server sends notifications using `send_log_message` without a `related_request_id`
- This makes them standalone notifications that arrive immediately
- Cline's McpHub now has notification handlers that display these as VS Code popups
- The notifications also appear in the console for debugging

## What you'll see

- VS Code info notifications like: "MCP notification-test: [notification_demo] Notification 1/5 sent after 0.52s total (waited 0.52s)"
- Console logs with full notification details
- Real-time updates as each notification arrives
