---
"cline": patch
---

fix: bypass git hooks on checkpoint initial commit

The initial checkpoint commit in `CheckpointGitOperations.ts` was missing
the `--no-verify` flag, causing Cline to fail to initialize when users
have global git pre-commit hooks (e.g., conventional commits enforcement).

Subsequent checkpoint commits already used `--no-verify` (in
`CheckpointTracker.ts`), but the initial empty commit did not, creating
an inconsistency.

Fixes #9672
