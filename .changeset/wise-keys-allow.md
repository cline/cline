---
"claude-dev": minor
---

## Checkpoints 2.0: **Branch-Per-Task** Architecture

### Key Changes
- **Branch-Per-Task:** Each repo now has a single Shadow Git repo, with separate branches per task (instead of one Shadow Git repo per task).
- **Legacy Support:** Existing Checkpoints remain functional, while all new Checkpoints use branch-per-task.
- **Expanded Exclusions:** More extensions added to the default exclusions list. TODO: Make user configurable.

### Feature Updates
- **Commits:** Legacy tasks commit to legacy Checkpoints; new tasks commit using branch-per-task.
- **Diffing & Deletions:** Both legacy and branch-per-task Checkpoints support diffing and deletion.

No migration needed—existing tasks stay as-is, and new tasks adopt **branch-per-task** automatically.

---

