---
"cline/cline": patch
---

Exclude generate_explanation tool from system prompt for non-VS Code platforms. The tool uses VS Code's Comments API which doesn't work on JetBrains or CLI.

Fixes #7807
