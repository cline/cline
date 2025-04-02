---
"claude-dev": patch
---

Added permissions checks, error handling, and git options to deal with cases where the entire workspace or specific files within it cannot be accessed. These issues were preventing checkpoints from working correctly, or causing checkpoints to hang.
