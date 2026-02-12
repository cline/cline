---
"cline": patch
---

Canonicalize `attempt_completion` tool args by mapping `response` to `result` in the central tool executor to prevent intermittent missing-parameter retries with native parallel tool calling.
