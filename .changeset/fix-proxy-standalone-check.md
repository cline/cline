---
"claude-dev": patch
---

Fixed TLS/proxy issues for users behind corporate MITM inspection proxies by correcting the IS_STANDALONE environment variable check. The check now uses explicit string comparison (`=== "true"`) instead of truthy evaluation, which was incorrectly triggering standalone mode in VSCode builds because the string `"false"` is truthy in JavaScript.
