---
"claude-dev": patch
---

Exclude generate_explanation tool from system prompt for non-VS Code platforms. This tool relies on VS Code's Comments API and is not supported on JetBrains or CLI.
