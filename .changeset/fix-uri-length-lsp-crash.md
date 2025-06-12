---
"roo-cline": patch
---

Fix C# LSP crashes caused by excessively long URIs in diff views and checkpoints. Added URI length validation to prevent crashes when working with large files by truncating content that would exceed safe URI length limits.
