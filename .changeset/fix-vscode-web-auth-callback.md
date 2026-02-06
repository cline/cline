---
"cline": patch
---

fix: use vscode.env.asExternalUri for auth callback URLs in VS Code Web

Fixes OAuth callback redirect in VS Code Web (`code serve-web`) environments. The callback URL now uses `vscode.env.asExternalUri()` to resolve to the correct URI for the current environment, preventing the redirect from opening the local desktop VS Code app instead of the web instance.
