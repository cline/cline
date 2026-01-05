---
"claude-dev": patch
---

Fixed connection failures with remote MCP servers that return 404 instead of 405 for SSE stream checks. This was causing "Failed to open SSE stream: Not Found" errors after the v3.46.0 SDK upgrade.
