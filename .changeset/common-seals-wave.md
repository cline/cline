---
"claude-dev": patch
---

Added exit code validation for terminal commands.

**What's new:**
- Extract exit code from VSCode shell integration OSC 633;D sequence
- Add `exitCode` field to `ITerminalProcess` interface
- Add `exitCode` to `OrchestrationResult`
- Update result messages to include exit code status (e.g., "Command executed successfully (exit code 0)" or "Command failed with exit code 1")

**Why:**
Commands now report their exit code in the result message, helping to identify failed commands even when they produce no error output. This is particularly useful for build scripts and other commands where a non-zero exit code indicates failure.

Fixes #7590
