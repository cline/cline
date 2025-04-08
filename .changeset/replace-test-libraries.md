---
"claude-dev": patch
---

Replace testing libraries with Vitest. Remove chai, sinon, should, and proxyquire in favor of Vitest's built-in testing utilities. Keep Mocha types for VSCode test runner compatibility. Use `__tests__` folder convention everywhere.
