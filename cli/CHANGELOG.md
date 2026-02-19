# cline

## 2.4.2

### Added

- Gemini-3.1 Pro Preview

### Patch Changes

- VSCode uses shared files for global, workspace and secret state.

## [2.4.1]

### Fixed

- Fix infinite retry loop when write_to_file fails with missing content parameter. Provides progressive guidance to the model, escalating from suggestions to hard stops, with context window awareness to break the loop.

## [2.4.0]

### Added

- Adding Anthropic Sonnet 4.6
- Allows users to enter custom aws region when selecting bedrock as a provider in CLI
- Keep reasoning rows visible when low-stakes tool groups start immediately after reasoning.
- Restore reasoning trace visibility in chat and improve the thinking row UX so streamed reasoning is visible, then collapsible after completion.

### Fixed

- Banners now display immediately when opening the extension instead of requiring user interaction first
- Resolved 17 security vulnerabilities including high-severity DoS issues in dependencies (body-parser, axios, qs, tar, and others)

## [2.2.2]

- Allows users to enter custom aws region when selecting bedrock as a provider
- Prevent Parent Container Scrolling In Dropdowns

## [2.2.1]

- Added Minimax 2.5 Free Promo
- Fixed Response chaining for OpenAI's Responses API

## [2.2.0]

### Added

- Subagent: replace legacy subagents with the native `use_subagents` tool
- Bundle `endpoints.json` support so packaged distributions can ship required endpoints out-of-the-box
- Amazon Bedrock: support parallel tool calling
- New "double-check completion" experimental feature to verify work before marking tasks complete
- CLI: new task controls/flags including custom `--thinking` token budget and `--max-consecutive-mistakes` for yolo runs
- Remote config: new UI/options (including connection/test buttons) and support for syncing deletion of remotely configured MCP servers
- Vertex / Claude Code: add 1M context model options for Claude Opus 4.6
- ZAI/GLM: add GLM-5

### Fixed

- CLI: handle stdin redirection correctly in CI/headless environments
- CLI: preserve OAuth callback paths during auth redirects
- VS Code Web: generate auth callback URLs via `vscode.env.asExternalUri` (OAuth callback reliability)
- Terminal: surface command exit codes in results and improve long-running `execute_command` timeout behavior
- UI: add loading indicator and fix `api_req_started` rendering
- Task streaming: prevent duplicate streamed text rows after completion
- API: preserve selected Vercel model when model metadata is missing
- Telemetry: route PostHog networking through proxy-aware shared fetch and ensure telemetry flushes on shutdown
- CI: increase Windows E2E test timeout to reduce flakiness

### Changed

- Settings/model UX: move "reasoning effort" into model configuration and expose it in settings
- CLI provider selection: limit provider list to those remotely configured
- UI: consolidate ViewHeader component/styling across views
- Tools: add auto-approval support for `attempt_completion` commands
- Remotely configured MCP server schema now supports custom headers

## [2.1.0]

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
