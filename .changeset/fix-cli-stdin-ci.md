---
"cline": patch
---

Fix CLI crashing in CI environments and with stdin redirection (e.g., `cline "prompt" < /dev/null`). Now checks both stdin and stdout TTY status before using Ink, and only errors on empty stdin when no prompt is provided.
