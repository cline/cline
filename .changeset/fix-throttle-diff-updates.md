---
"claude-dev": patch
---

fix: throttle diff view updates during streaming

Add throttling to diff view updates during content streaming to reduce UI flickering and improve performance. Updates are now batched at reasonable intervals instead of firing on every token received.
