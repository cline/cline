---
"claude-dev": patch
---

fix: preserve environment variables when toggling server disabled state

Previously, toggling an MCP server's disabled state via the UI would expand `${env:VAR_NAME}` variables in the config file, replacing the variable references with their actual values. This fix preserves the original variable syntax by reading the raw config file instead of the validated/expanded version.
