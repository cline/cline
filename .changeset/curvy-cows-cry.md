---
"roo-cline": patch
---

fix: ensure consistent line endings in git fallback strategy

Fixed a cross-platform issue where tests would fail on GitHub Windows runners but pass on local Windows machines due to line ending differences. The fix ensures consistent line ending handling by:

1. Normalizing CRLF to LF when reading files in the git fallback strategy
2. Disabling Git's automatic line ending conversion using core.autocrlf setting
3. Maintaining consistent line ending usage throughout the text operations
