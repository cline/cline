---
"cline": patch
---

fix: use vscode.env.asExternalUri for auth callback URLs only in VS Code Web

Fixes OAuth callback redirect in VS Code Web (`code serve-web`, Codespaces) by using `vscode.env.asExternalUri()` to resolve the callback URI. This is gated behind a `vscode.env.uiKind === UIKind.Web` check so regular desktop VS Code continues to use the `vscode://` URI directly. The `getCallbackUrl` API now accepts a `path` parameter so the full callback URI (including route) is resolved correctly, and callers pass their path directly instead of appending after.
