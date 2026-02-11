# cline

## 2.1.0

### Minor Changes

- 42ce100: Add Generate API Key on Hicap Provider selection

### Patch Changes

- 195294f: Add support for bundled endpoints.json in enterprise distributions. Extensions can now include a pre-configured endpoints.json file that automatically switches Cline to self-hosted mode. Includes packaging scripts for VSIX, NPM, and JetBrains plugins.
- a1f2601: Replace the LiteLLM model list with a selector
- 739d75a: Add Claude Code provider support for Claude Opus 4.6 and Sonnet 4.5 1M variants via both full model names and aliases (`opus[1m]`, `sonnet[1m]`), and align the `opus` alias with Opus 4.6.
- 8440380: Add GitHub Actions workflow to build CLI from any commit for testing
- b1a8db2: fix(cli): prevent hang when spawned without TTY
- 7c87017: Add Claude Opus 4.6 model support
- d116ac5: Supports rendering markdown table in chat view.
- 6d8fb85: Fix CLI crashing in CI environments and with stdin redirection (e.g., `cline "prompt" < /dev/null`). Now checks both stdin and stdout TTY status before using Ink, and only errors on empty stdin when no prompt is provided.
- 70a9904: Fix JetBrains sign-in regression by adding fallback for openExternal RPC
- f440f3a: fix: use vscode.env.openExternal for auth in remote environments

  Fixes OAuth authentication in VS Code Server and remote environments by routing browser URL opening through VS Code's native openExternal API instead of the npm 'open' package.

- 70a9904: fix: use vscode.env.asExternalUri for auth callback URLs only in VS Code Web

  Fixes OAuth callback redirect in VS Code Web (`code serve-web`, Codespaces) by using `vscode.env.asExternalUri()` to resolve the callback URI. This is gated behind a `vscode.env.uiKind === UIKind.Web` check so regular desktop VS Code continues to use the `vscode://` URI directly. The `getCallbackUrl` API now accepts a `path` parameter so the full callback URI (including route) is resolved correctly, and callers pass their path directly instead of appending after.

- 5308ded: Updating script documentation and removing unnecessary continue on error
- b514f18: Prevent duplicate streamed text rows when a partial text update arrives after the same text was already finalized.
- 26391c9: Fix Bedrock model id
- d19a877: Unify ViewHeader Styles Across All Views
- 5dcaa8c: Add Vertex Claude Opus 4.6 1M model option and global endpoint support, and pass the 1M beta header for Vertex Claude requests.
