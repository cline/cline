---
"claude-dev": patch
---

feat: Add confirmation dialog to settings save

Adds a confirmation step when a user clicks the "Save" button in the settings view. This prevents accidental saving of settings.
Also resolves TypeScript errors related to gRPC client usage for the state reset functionality.
