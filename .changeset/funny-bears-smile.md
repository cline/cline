---
"claude-dev": patch
---

Fix paste and drop operations to respect the 'Supports images' toggle in model configuration. Previously, images could be added via paste/drop even when the model didn't support images.
