---
"cline": patch
---

fix: resolve "Could not find the file context" error in Explain Changes comment replies

When clicking a line to start a discussion in the Explain Changes diff view, replies would
intermittently fail with "Error: Could not find the file context". This happened because
the reply handler and the `onCommentStart` callback were using a strict `absolutePath`-only
match to look up files in `changedFiles`, while the VS Code comment controller may return
paths in different formats (relative vs. absolute, different separators on Windows, etc.).

Fixed by adding a `relativePath` fallback in both lookup sites, making them consistent with
the already-correct logic in `streamAIExplanationComments`.

Fixes #9382
