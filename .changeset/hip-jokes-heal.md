---
"claude-dev": patch
---

Fix MCP server name display logic to avoid showing `undefined` when `command` is missing, preventing tool/resource invocation failures for sse servers.
