---
"claude-dev": patch
---

Stop the core process from dying 3 seconds after a hook or MCP server exits without reading its input. The pending stdin write failed with EPIPE and escaped as an uncaught exception, and a winston handler pulled in by the SAP AI Core provider turned that into `process.exit(1)` -- surfaced on JetBrains as "cline-core exited unexpectedly with code 1" after submitting a prompt with URL content.
