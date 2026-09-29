---
"claude-dev": patch
---

Fix production logs dropping the details of logged errors: lines like "Cline OAuth login failed:" now include the error message, so bug reports show why an operation failed
