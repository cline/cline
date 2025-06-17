---
"claude-dev": minor
---

feat: Add editable command approval interface

Implements GitHub issue #275 - "Edit CLI command before Claude runs it". Users can now edit commands in the approval dialog before execution, providing better control over command execution.

Key features:
- Editable command interface with syntax highlighting
- Edit/Save/Cancel buttons with keyboard shortcuts (Ctrl+Enter to save, Escape to cancel)
- Seamless integration with existing approval workflow
- Command changes are preserved and sent to the extension when approved
- Clean, VSCode-themed UI that matches the existing design

This enhancement improves user experience by allowing quick command modifications without requiring back-and-forth conversation with Claude.
