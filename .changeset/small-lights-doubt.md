---
"claude-dev": patch
---

fix: wrap file mentions with spaces in quotes

Fixes #7789 - When using "Add to Cline" on files with spaces in their paths,
the generated mention text is now properly wrapped in quotes so it can be
parsed correctly.
