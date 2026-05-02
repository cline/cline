# cline

## [2.18.0]

### Added

- Restore foreground terminal support and settings.
- Add latest OpenAI, SAP AI Core, and Z AI models.

### Fixed

- Fix hook template JSON escaping.
- Improve ripgrep file search error handling.

### Changed

- Remove hardcoded model lists from docs.

## [2.17.0]

### Added

- Add GPT-5.5 model support for OpenAI Codex subscription users.

### Changed

- Improve `cline-core` runtime memory diagnostics used by CLI:
  - enable near-heap-limit heap snapshots
  - add periodic memory usage logging
  - log discovered heap snapshots on abnormal exits for easier OOM debugging

## [2.16.0]

### Added

- Wire up remote `globalSkills` from enterprise remote config with full toggle support and system prompt integration — enterprise-managed skills now support `alwaysEnabled` enforcement
- Add dedicated "Quota Exceeded" error message when Cline account spend caps are hit

### Fixed

- Fix OOM crashes during long conversations by setting `--max-old-space-size=8192` for the cline-core Node.js process (was defaulting to ~2 GB)
- Show detailed error information instead of a generic caught error message
- Update `axios` to 1.15.0 across all packages

### Changed

- Remove dead ACP terminal setter stubs as part of foreground terminal mode removal

## [2.15.0]

### Added

- Add Claude Opus 4.7 model support
- Inline value reuse in user-level remote-config discovery
- Add `globalSkills` to remote config

### Fixed

- Stabilize Windows CI test path handling

## [2.14.0]

### Added

- Simplify unified `cline update` flow for `cline` and `kanban`
- Docs updates

### Fixed

- Update Kanban migration view copy

## [2.12.0]

### Added

- `read_file` tool now supports chunked reading for targeted file access

### Fixed

- Exclude `new_task` tool from system prompt in yolo/headless mode

### Changed

- Polish `Notification` hook functionality

## [2.9.0]

### Added

- Latency improvements for remote workspaces

## [2.8.2]

### Fixed
- Use `kanban@latest` in `cline kanban` to always fetch the newest version

## [2.8.1]

### Added
- Implement dynamic free model detection for Cline API
- Add file read deduplication cache to prevent repeated reads
- Add feature tips tooltip during thinking state

### Fixed
- Fix flaky CLI Enter-key handling across Windows/test environments
- Replace error message when not logged in to Cline
- Align ClineRulesToggleModal padding with ServersToggleModal
- Skip WebP for GLM and Devstral models running through llama.cpp
- Respect user-configured context window in LiteLLM getModel()
- Honor explicit model IDs outside static catalog in W&B provider
- Add missing Fireworks serverless models and pricing

## [2.8.0]

### Added

- Added W&B Inference by CoreWeave as a new API provider with 17 models including DeepSeek-V3.1, Llama 4, and Qwen3-Coder
- Added CLI TUI end-to-end test suite

### Fixed

- Claude Code: handle rate limit events, empty content arrays, error results, and unknown content types without crashing
- CLI: `/q` and `/exit` slash commands now execute immediately on Enter without requiring the slash menu to be visible
- CLI: slash command filtering now prioritizes exact and prefix matches over fuzzy matches

## [2.7.0]

### Added

- Added MCP add shortcuts for stdio and HTTP servers
- Added `--continue` for the current directory
- Added `--auto-condense` flag for AI-powered context compaction
- Added `--hooks-dir` flag for runtime hook injection
- Enabled error autocapture
- Prompt rules now include test verification guidance and make `CLI_RULES` language-agnostic

### Fixed

- Fixed remount behavior so TUI remounts only on width resize
- Fixed startup prompt replay on resize remount
- Fixed task flags so they are applied before the welcome TUI mounts

### Changed

- Hooks: reintroduced feature toggle

## [2.6.1]

### Added

- Added GPT-5.4 models for ChatGPT subscription users
- Hooks: Added a `Notification` hook for attention and completion boundaries
- Added `--hooks-dir` CLI flag for runtime hook injection
- Added `--auto-approve-all` CLI flag for interactive mode

### Fixed

- Handle streamable HTTP MCP reconnects more reliably

## [2.6.0]

### Added

- Hook payloads now include `model.provider` and `model.slug` 
- Token/cost updates now happen immediately as usage chunks arrive, not after tool execution

### Fixed

- Improve subagent context compaction logic
- Subagent stream retry delay increased to reduce noise from transient failures
- State serialization errors are now caught and logged instead of crashing
- Removed incorrect `max_tokens` from OpenRouter requests

## [2.5.2]

### Added

- Added Windows PowerShell support for hooks (execution, resolution, and management), improving hook behavior on Windows for CLI and shared core workflows.

### Fixed

- Restored GPT-OSS native file editing for OpenAI-compatible models used through shared core tooling.
- Improved OpenRouter context overflow error handling so auto-compaction triggers correctly for wrapped 400 errors.
- Hardened checkpoint recovery by retrying nested git restore and preventing silent `.git_disabled` leftovers.
- Added a User-Agent header for requests to the Cline back-end to improve request handling consistency.

## [2.5.1]

### Added

- Expanded CLI markdown rendering support (headings, lists, blockquotes, fenced code blocks, links, and nested lists).

### Fixed

- Fixed CLI headless auth provider model metadata loading for Cline and Vercel AI Gateway by fetching model info from API with cache fallback.
- Increased flaky CLI import test timeout on Windows CI to reduce intermittent test failures.

## [2.5.0]

### Added

- Added Cline SDK API interface for programmatic access to Cline features and tools, enabling integration into custom applications.
- Added Codex 5.3 model support

### Fixed

- Fix OpenAI Codex by setting `store` to `false`
- Use `isLocatedInPath()` instead of string matching for path containment checks

## [2.4.3]

### Added

- Add /q command to quit CLI
- Fetch featured models from backend with local fallback

### Fixed

- Fix auth check for ACP mode
- Fix Cline auth with ACP flag
- Fix yolo mode to not persist yolo setting to disk

## [2.4.2]

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
