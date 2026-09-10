---
"claude-dev": patch
---

Fix the "Add Files & Images" picker hiding image files when the selected model's capabilities have not been resolved yet: only exclude images when the model is known not to support them, matching the composer's existing behavior
