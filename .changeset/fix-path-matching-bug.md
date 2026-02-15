---
"claude-dev": patch---
fix: correct path containment check in getReadablePath to avoid false positives

Fix path matching bug where directories with shared prefixes were incorrectly matched (fixes #8761).

**Problem:** The code used `absolutePath.includes(cwd)` which performs a simple substring match, causing false positives when directory names share a prefix. For example, `/home/user/project-backup` was incorrectly treated as being inside `/home/user/project`.

**Solution:** Replace `includes()` with the existing `isLocatedInPath()` function which properly checks path containment using `path.relative()` and validates that the path is actually inside the directory (not just a substring match).

**Impact:** Files outside the workspace are now correctly identified with absolute paths instead of incorrect relative paths.
