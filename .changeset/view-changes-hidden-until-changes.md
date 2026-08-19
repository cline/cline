---
"claude-dev": patch
---

Hide the "View Changes" button on completion rows until there are actually changes to show, instead of rendering it faded and disabled. Turns that changed nothing, non-git workspaces, and repos without commits no longer show a dead button with a misleading tooltip.
