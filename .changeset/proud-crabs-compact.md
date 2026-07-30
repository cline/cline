---
"claude-dev": patch
---

Enable Auto Compact by default so long chats automatically summarize instead of failing at the model context limit, and make compaction reliable: persist and reuse compaction state across turns, fold completed parallel tool blocks safely, preserve key facts from completed tool results in the summary, and report before/after token counts on a consistent baseline. Auto Compact can be disabled in Settings → Features → "Auto Compact".
