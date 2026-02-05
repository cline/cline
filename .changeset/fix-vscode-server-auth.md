---
"cline": patch
---

fix: use vscode.env.openExternal for auth in remote environments

Fixes OAuth authentication in VS Code Server and remote environments by routing browser URL opening through VS Code's native openExternal API instead of the npm 'open' package.
