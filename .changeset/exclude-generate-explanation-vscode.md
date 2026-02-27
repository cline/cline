---
"claude-dev": patch
---

feat: exclude generate_explanation tool from non-VS Code platforms

The generate_explanation tool now checks for VS Code IDE before being included in the system prompt. This prevents the tool from appearing on JetBrains and CLI platforms where the Comments API is not available.
