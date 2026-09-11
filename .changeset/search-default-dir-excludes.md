---
"claude-dev": patch
---

Fix search_files flooding results with dependency and build directories: the ripgrep search path now applies the default exclude list (node_modules, vendor, bin, obj, dist, etc.) explicitly instead of relying only on .gitignore, which ripgrep skips outside git repositories and which does not cover committed vendored dependencies
