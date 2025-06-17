---
"claude-dev": major
---

**"Fix critical bug preventing .clinerules files from being applied to system prompts"**This is a major version bump because:1. It fixes a core feature that was completely broken2. It affects all users who rely on .clinerules functionality3. It restores expected behavior that users depend onThe fix resolves issue #4257 where rules were being loaded but never actually applied due to a conditional check failure in the rule loading system.
