---
"claude-dev": patch
---

Fix a streaming crash when a chunk has usage data but no `delta` by guarding reasoning field checks in provider handlers. Add regression tests for OpenRouter, Cline, Vercel AI Gateway, and Fireworks handlers to cover usage-only chunks.
