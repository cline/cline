---
"claude-dev": patch
---

fix: when workflows in different scopes share a name, `/workflow` commands now expand the highest-precedence file (workspace over global, remote-config last) instead of whichever directory was scanned last — restoring the legacy local-over-global workflow precedence
