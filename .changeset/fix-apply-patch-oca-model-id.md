---
"claude-dev": patch
---

fix: apply_patch tool now works with OCA provider's gpt5 model ID format

The apply_patch tool's contextRequirements was filtering out models that didn't include "gpt-5" (with hyphen) in their model ID. OCA uses "oca/gpt5" (no hyphen), causing apply_patch to be unavailable and forcing the model to fall back to bash for file edits. Now uses isGPT5ModelFamily() for consistent model detection.
