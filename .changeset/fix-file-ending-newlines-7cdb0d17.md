---"claude-dev": patch---
fix: ensure exactly one newline at end of files in FileEditProvider

Fixes inconsistent file formatting by normalizing trailing newlines to exactly one per file during save operations. This addresses issue #8610 where Cline was removing or not adding blank lines at the end of files.

Behavior:
- Ensures exactly one newline at end of all files after code changes
- Handles empty files, single/multi-line content, and existing newlines
- Normalizes multiple trailing newlines to exactly one

Misc:
- Modified FileEditProvider.saveDocument() to enforce consistent newline behavior
- Maintains JetBrains plugin compatibility and existing functionality
