---
"claude-dev": patch
---

Add endpoint configuration file support for on-premise deployments

Enterprise customers can now configure custom API endpoints by creating a `~/.cline/endpoints.json` file with custom URLs for `appBaseUrl`, `apiBaseUrl`, and `mcpBaseUrl`. When this file is present, Cline runs in on-premise mode with the custom endpoints.
