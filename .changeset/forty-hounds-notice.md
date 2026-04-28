---
"cline": patch
---

Fix readable path containment checks to avoid false positives for directories that share prefixes (for example, `project` vs `project-backup`).
