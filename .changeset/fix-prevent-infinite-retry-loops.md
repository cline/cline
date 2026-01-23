---
"claude-dev": patch
---

fix: prevent infinite retry loops when replace_in_file fails repeatedly

Add safeguards to prevent the LLM from getting stuck in infinite retry loops when `replace_in_file` operations fail repeatedly. The system now detects repeated failures and provides better guidance to break out of retry cycles.
