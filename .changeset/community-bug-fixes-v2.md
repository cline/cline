---
"claude-dev": patch
---

fix: community-reported bug fixes

Bug Fixes:
- DeepSeek V3.2: Handle XML tool patterns in reasoning_content (fixes #8365)
  - DeepSeek V3.2 sometimes emits tool calls in reasoning content using XML format
  - Added containsXmlToolPattern() helper to detect these patterns
  - Yield as text instead of reasoning when patterns detected to allow proper processing
- Input Parsing: Add safeParseFloat/safeParseInt for decimal inputs (fixes #8129)
  - Handle edge cases like ".25" or "0." that would previously crash with NaN
  - Applied to Input Price, Output Price, and Temperature fields in OpenAI Compatible settings
