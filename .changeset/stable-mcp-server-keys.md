---
"claude-dev": patch
---

fix: use stable server name for MCP tool routing

MCP server keys are now derived from the server name (sanitized) instead of ephemeral nanoid. This ensures tool routing remains stable across extension restarts and reconnects.
