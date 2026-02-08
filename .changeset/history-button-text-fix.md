---
"claude-dev": patch
---

Fix button text not updating after deleting history item using side delete icon. When deleting a selected history item via the side icon, the selected items state is now properly cleared, causing the button text to correctly revert to "Delete all history" instead of remaining "Delete selected history."

Fixes #6033
