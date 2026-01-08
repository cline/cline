---
"claude-dev": patch
---

Fix two bugs in DiffViewProvider file editing:

1. **Line boundary validation**: Add `safelyTruncateDocument()` to prevent out-of-bounds line errors on JetBrains hosts (fixes #8423, #8429). The gRPC protocol strictly validates line numbers, causing "truncateDocument INTERNAL: Wrong line" errors when `truncateDocument()` was called with a line number >= document line count.

2. **Content concatenation on final update**: When replacing content without a trailing newline, the old content at line N+1 was concatenated to the new content. Fixed by extending the replacement range to cover the entire document on final update.
