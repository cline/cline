---
"cline": patch
---

Fix: Hide VS Code-specific banners (CLI install, Enable Subagents) on JetBrains IDEs

Added IDE type filtering to the banner system. Banners can now specify which IDE types they should appear on using the `ideTypes` property. The CLI installation and subagents banners are now marked as VS Code-only, preventing them from showing on JetBrains where these features are not implemented.
