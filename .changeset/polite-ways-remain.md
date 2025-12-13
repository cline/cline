---
"claude-dev": patch
---

Fixed race condition in mode toggle by replacing hardcoded 250ms delay with proper async/await for API configuration save. This improves reliability on both slow and fast systems, ensures configuration is always saved before mode changes, and provides better error handling.
