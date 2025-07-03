---
"claude-dev": patch
---

fixed: "Discard Changes" button in UnsavedChangesDialog not working properly
- Added proper event handlers to ensure dialog closes after executing callbacks
- Fixed issue where clicking "Discard Changes" would call the callback but leave dialog open
- Improved user experience by ensuring dialog dismisses correctly after all button actions
This change ensures that when users click "Discard Changes" (or any other action button) in the unsaved changes dialog, the dialog properly closes after executing the intended action.
