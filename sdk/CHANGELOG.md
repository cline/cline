# Cline SDK Changelog

## 0.0.75

- Added provider-executed web search. Models that support it can search the web during a turn, and the search calls and their results are persisted in session history so they replay on reload. Off by default; enable the `web_search` model tool in settings
- Added a dedicated Cline provider for the Cline gateway, replacing the generic OpenAI-compatible path. Extended thinking budgets and other gateway options now reach the wire for both `cline` and `cline-pass`, which had silently stopped applying to `cline-pass`
- Fixed two Cline installations on different builds shutting each other's Hub daemon down in a loop, killing every live session with an abnormal socket close. Build identity is now compared through a total order, so at most one side of a pair can ever decide to retire the other
- A newer build no longer replaces a Hub that is serving live sessions — it attaches over the compatible wire protocol and the swap happens once the Hub is idle, instead of the sessions dying mid-handshake
- Development builds now run their own Hub daemon per build id instead of contending for a single record; production keeps its singleton
- Idle plugin sandbox processes are now reclaimed instead of lingering for the life of the session
- `cline doctor fix` now reports honestly: processes that survived a kill are separated from ones that appeared while the fix ran, a live parent respawning a daemon is named, and a startup lock held by a running process is reported as held rather than leaked
- Refreshed the model catalog, which adds Crusoe as a provider and updates model lists and per-provider default models across the board

## 0.0.74

- Fixed the Claude Code provider being unusable for agentic work: the provider now declares its own native tools instead of receiving Cline's unbridgeable tool definitions, the session is anchored on the workspace directory instead of inheriting the host's cwd, and `~/.claude` plus project settings are loaded so user-configured permission rules apply. File edits under the workspace are auto-approved; command execution stays gated by your own Claude settings
- Fixed truncated tool-call JSON being silently "repaired" into wrong arguments — a payload with an unterminated string is now rejected rather than getting an invented terminator
- Fixed strict providers rejecting a turn with "user message must have content" when a message's content held only empty text parts
- Fixed a mid-turn crash on streamed tool calls with non-zero or non-contiguous indexes, hit through LiteLLM's Anthropic passthrough, by updating the AI SDK packages
- Managed Hub daemons now upgrade directionally: when another install ships a newer Hub build, hosts attach to the newer daemon and prompt to update and restart instead of the two installs repeatedly retiring each other's daemons. Older or unordered Hubs are still retired and replaced
- Fixed the Hub daemon logging an unhandled `hub server close failed` rejection and exiting non-zero whenever a client was connected at shutdown; shutdown is now clean
- `run.started` is now emitted only after the target session resolves and carries the originating `requestId` and `clientId`, so multi-client hosts can correlate delivery acknowledgments
- Token telemetry now reports disjoint per-request buckets — uncached input, cache reads, cache writes — instead of re-counting the whole cached conversation on every event, which inflated per-task sums roughly 5x on cache-heavy sessions
- Involuntary Cline logouts (a rejected refresh token) are now reported instead of credentials being cleared silently; a transient network failure refreshing the stored session on startup no longer books as a logout
- Per-token stream deltas are no longer mirrored into telemetry — they accounted for ~97% of all agent event volume with no analytical value

## 0.0.73

- Fixed hosts reconnecting to stale managed Hub daemons: daemons now carry a runtime build fingerprint, so upgrading retires and respawns a daemon still running older code instead of attaching to it
- Fixed compaction being silently skipped on reasoning models. The summarizer no longer hardcodes a 1024-token output cap — it honors an explicit max-output-tokens setting, defaults to 4096 (lowered when the model reports less), and logs a diagnostic when a summary comes back empty
- Added Fable 5 (`claude-fable-5`) to the Vertex model catalog. Pricing is intentionally omitted because Vertex bills region-dependently, so cost shows as unknown rather than wrong
- Custom Vertex model IDs are now passed through unchanged, routing Claude-style IDs to the Anthropic-on-Vertex path

## 0.0.72

- Prompts queued during a turn now survive being interrupted: they are preserved across user-initiated aborts, drained after a turn aborts itself, and edits made to the queue inside the abort window are applied rather than lost. Stopping a session now has consistent full-stop semantics across hosts
- Session context stays durable across aborts and hub restarts, so an interrupted session resumes with the state it had rather than a reset one
- Queued turns that fail are now reported as `run.failed` instead of completing silently
- A hung MCP server no longer takes down session creation, and stdio servers that were never configured get a 30-second initialize budget instead of blocking indefinitely
- Remote SSE MCP servers now surface an OAuth authorization prompt on a 401 instead of failing outright, and remote MCP supports pre-registered OAuth clients for setups where dynamic client registration isn't available
- LiteLLM requests route through Chat Completions instead of the Responses API, fixing calls against LiteLLM proxies
- Network interruptions that happen mid-stream but before any model output are retried instead of failing the turn
- Vertex ADC token refreshes use the configured fetch, so they work behind proxies and custom transports
- Checkpoint diffs now include files that were untracked when the snapshot was taken, and checkpoints are picked up when git is initialized part-way through a session
- Plugin settings and contributions are centralized in the hub, with host-aware snapshots and atomic host plugin toggles; a source host no longer runs a foreign compiled plugin-sandbox bootstrap
- Scheduled run reports carry execution context — readable headers, schedule metadata, durations, and lifecycle error details

## 0.0.71

- Reasoning settings now resolve portably across AI SDK providers — effort levels and enable/disable flags map to the AI SDK's native reasoning setting (including Ollama), replacing the per-provider thinking overrides, and an explicit request to disable reasoning now takes priority
- `sdk.error` telemetry from agent runs is attributed to the model actually in use, and undefined values are stripped from the event properties
- Refreshed the model catalog from models.dev, and surfaced `meta/muse-spark-1.2-contributor` for the Cline provider

## 0.0.70

- Plan mode now hard-blocks file-editing shell commands instead of relying on prompting alone — `run_commands` stays available for read-only investigation, but file-manipulation commands, in-place editors (`sed -i`, `perl -i`), redirection to files, mutating git subcommands, package installs, and nested command strings (`sh -c`, `eval`, `sudo`, `xargs`) are rejected with a tool error, on Windows and PowerShell too
- Context-window overflow errors are now detected and recovered from instead of surfacing as raw unclassified provider errors: the runtime force-compacts with a deterministic strategy that needs no extra LLM call and retries the run once, and terminal cases (nothing left to compact, a retry that still overflows) fail with an actionable message
- Sessions now record how they began — a new `mode` on `StartSessionInput` (`user`, `automation`, `subagent`, `team`) alongside `source` — and root-session persistence is lazy: starting a runtime allocates the session id in memory without writing a database row, so closing it before any user turn no longer leaves an empty history entry
- Turns that come back completely empty are now retried on every provider, not just Ollama — hosted backends (OpenRouter, Cline, OpenAI-compatible endpoints) previously failed the task outright with "Model returned empty response". Tool-call-only turns are never retried, and turns that error or hit the token limit pass through unchanged
- Adaptive-era Claude models (4.6+ and 5.x) are no longer sent the manual thinking wire shape and rejected with "thinking.type.enabled is not supported" — the baked model catalog now carries reasoning metadata, and unlisted or user-typed adaptive ids are inferred correctly when that metadata is missing
- Bedrock prompt caching works again: the provider now emits Converse `cachePoint` markers instead of Anthropic `cache_control`, which the Bedrock converter silently dropped, so cache reads and writes are no longer always 0 and no stray `cache_control` field leaks into the request body
- Bedrock foundation models are now routed through geo inference profiles
- Reasoning models on OpenAI-compatible endpoints now receive `max_completion_tokens` instead of the rejected `max_tokens`
- Requests to models without image support now substitute image content instead of failing
- MiniMax now inherits its default model from models.dev
- Upgraded the model layer to AI SDK 7, switched Ollama to the native AI SDK provider (with wire-contract fixes for empty `think` settings, mid-stream errors, and attachment-only turns), and emitted the canonical AI SDK 7 file parts for images so image-bearing requests no longer log deprecation warnings
- `sdk.error` telemetry is no longer emitted twice for the same provider failure, and repeated failures from unattended retry loops are rate-limited

## 0.0.69

- Ollama's response-start timeout now defaults to 5 minutes instead of 30 seconds, so large models that cold-load no longer fail before they finish loading — unreachable servers still fail immediately, requests are still cancelable, and an explicit `requestTimeoutMs` is still honored
- Ollama turns that come back completely empty (no text, reasoning, or tool call) are now retried at the model boundary instead of failing the task with "Model returned empty response"; non-empty turns stream through with no added latency, and turns that error or hit the token limit pass through unchanged
- Checkpoints are created again in VS Code and the CLI — run-boundary detection assumed the run's prompt arrives as run input, but both hosts seed it into the initial messages, so no checkpoints were ever recorded. Detection now also survives process restarts and compaction
- Checkpoint restore is now a true workspace rewind: files Cline created during a task are captured in the snapshot and restored to their checkpoint-time content, and files created after the checkpoint are removed. `.gitignore`d paths (build output, `node_modules`, `.env`) are left untouched, and a pre-restore recovery snapshot can roll the whole operation back. Checkpoints taken before this change keep the old conservative behavior of never touching untracked files
- Migrated users whose stored Cline model id isn't in the runtime catalog now fall back to the default Cline model instead of carrying an unknown id into every inference request
- Tool-use mistake notices are no longer reported as provider API errors, provider errors are no longer double-counted, and provider error details are preserved

## 0.0.68

- Provider errors forwarded through the Vercel AI Gateway now surface the real upstream message (e.g. "This model's maximum context length is 40960 tokens...") instead of a raw Zod issue dump, and opaque object errors no longer render as `[object Object]`
- `fetchClineRecommendedModels` now returns display-ready model names, resolved through the model catalog (including Vercel and OpenRouter id aliases) under a single shared timeout budget, so hosts no longer have to map ids to names themselves
- Cline free models now resolve their OpenRouter display names in the catalog
- The live catalog no longer drops the video input capability
- On Windows, PowerShell commands now travel over UTF-8 stdin instead of the command line, so non-ASCII commands survive the active code page and long commands are not capped by the Windows command-line limit — `getShellInvocation()` replaces the now-deprecated `getShellArgs()`, and a stdin write failure surfaces as a command error instead of hanging
- Fixed sessions rooted at the filesystem root (`/`) failing to run any command: `basename("/")` produced an empty workspace hint that schema validation rejected, so every command threw
- Exported the finish-reason and auth-error helpers used to describe agent errors

## 0.0.67

- Reasoning controls (effort, budget, on/off) are now driven by the models.dev catalog and normalized once before provider encoding, so requests match what each provider actually advertises; Anthropic's mandatory and impossible thinking modes are handled explicitly, and out-of-range budgets are clamped
- OpenRouter now defaults to `anthropic/claude-sonnet-5`
- The per-server `timeout` in `cline_mcp_settings.json` is now honored by the SDK's MCP clients for `initialize`, `tools/list`, and `tools/call` instead of hardcoded 1.5s and 5s limits — it defaults to 60 seconds and is clamped to 1–3600 seconds
- Fixed the China and international endpoint toggles being ignored for Qwen, Moonshot, and Z AI
- Legacy API keys are now migrated for every secret-backed provider instead of a subset
- Legacy OpenAI Compatible model-info overrides are now carried into the seeded `models.json` instead of being dropped
- Removed the "Enable R1 messages format" option from the OpenAI Compatible provider
- Fixed checkpoint restores across session resumes
- Added session forking and user-run message APIs so a host can edit an earlier prompt: fork the session before a selected user run, trim checkpoint history, and restore the prior messages
- Fixed auto-compaction state being rejected as stale on every save, which forced a full re-compaction — an extra summarizer call — on every turn past the trigger, and could leave a dead sidecar permanently blocking replacements after a resume
- Added `ClineCore.readLiveMessages` for reading a resident session's in-memory transcript, so a plan/act rebuild during an in-flight turn no longer starts from an empty history
- `insert_line` and the `read_files` line bounds now accept numbers emitted as JSON strings instead of failing the whole tool call
- Plugins can now emit telemetry through `ctx.telemetry`, from both the subprocess sandbox and in-process execution
- A legacy single-file `.clinerules` no longer aborts the config scan
- Telemetry events now carry `device_id`
- A malformed OTEL header entry no longer discards the valid ones

## 0.0.66

- Support for free Cline models (`cline-free`): free models are labeled "(free)", priced at zero, and hitting the free tier now raises a dedicated limit error that includes the reset time
- Agentic compaction is now the default context-compaction strategy
- Fixed agentic compaction silently falling back to basic compaction on OpenAI Compatible providers (the summarizer built its handler without a base URL and hit api.openai.com), and manual compaction budgeting against a 64k fallback instead of the model's real context window
- Fixed agentic compaction never finding a cut point in tool-heavy transcripts, which produced endless "auto-compaction skipped" while context kept growing — assistant messages are now valid cut boundaries
- Connector sessions now persist and automatically reconnect after a daemon or hub restart
- Plan/act mode, tool auto-approve, and compaction mode are now persisted in global settings, with cross-process-safe writes so two hosts no longer clobber each other's changes
- The built-in provider list is now generated from models.dev, broadening out-of-the-box provider coverage
- The editor tool preserves a file's existing line endings — CRLF files no longer end up with mixed endings and failing exact-match edits
- SAP AI Core now sets the metering header and uses the fetch adapter
- Headless scheduled routines default to auto-approve and no longer ask questions no one can answer
- Telemetry: task lifecycle events, auth event metadata and request IDs, and correct host identity (`host_plugin_version`, platform) on SDK-pipeline events
- Removed the never-invoked `onRetryAttempt` callback from `ApiHandlerOptions` and provider config
- `@cline/ui`: host-safe theme contract and Markdown exports
- Updated the bundled model catalog

## 0.0.65

- Claude Code and Codex provider SDKs are now optional peer dependencies loaded on demand, dramatically cutting install size
- Added Kimi K3 to the bundled ClinePass model fallback
- Runs now retry once after refreshing expired OAuth credentials
- Team runs: the spawn tool is no longer exposed to teammate agents
- Team runs: errored teammate runs now report as failed instead of completed
- Improved shell-command parsing to fix a Windows shell mismatch
- New `@cline/ui` agent chat components with Storybook and npm packaging
- Updated the bundled model catalog

## 0.0.64

- Improved max output token handling across providers (gateway routing, OpenAI vendor, and reasoning models)
- Frontmatter and user-instruction files that start with a UTF-8 byte order mark (e.g. saved by Windows editors) now parse correctly

## 0.0.63

- The session runtime now emits `task.mistake_limit_reached` telemetry when the consecutive-mistake limit is hit, so every host (CLI, VS Code extension, hub daemon) captures it — including auto-stops when no host prompt is configured

## 0.0.62

- Fixed Ollama native API routing so context window and timeout settings work again
- Telemetry is no longer attached to hub tool contexts

## 0.0.61

- Context compaction now reports progress status while it runs
- Workspace git info (branch/remote) is now persisted and refreshed across sessions
- Fixed benign git states being reported as workspace initialization errors
- Plan/Act mode guidance added to the system prompt, with nudges when switching modes
- Editor diff view restored for SDK edit tools
- Model IDs are now suggested from OpenAI-compatible endpoints
- VS Code terminal reliability improvements (OSC 633 parsing, exit codes, timeout handling)
- Provider-specific request headers are now centralized in the LLM layer
- Telemetry now attaches organization context when identifying with cached credentials
- Added a shared `@cline/ui` theme package

## 0.0.60

- Fixed an issue where a transient network or server error during token refresh could log you out — transient failures no longer clear your credentials
- Added the ClinePass usage-limit error so limit-reached responses are surfaced clearly
- Session id is now preserved when continuing within the same session
- Fixed infinite loading when initializing a task with an image
- Hardened compaction budget handling
- Added telemetry for auth-refresh outcomes and Cline credential lifecycle debug logging

## 0.0.59

- You can now select Cline free models on the ClinePass provider
- The SDK now recognizes ClinePass rate-limit responses and surfaces them as a typed `ClinePassLimitError` (with `isClinePassLimitMessage` / `extractClinePassLimitMessage` helpers)
- Removed references to the retired ClinePass GLM 5.1 model
- Fixed OpenAI Codex model metadata under the GPT Subscription provider
- The detached hub daemon process now emits telemetry
- SDK/CLI telemetry identity attributes now include `user_id`
- Cline provider requests now send versioned Cline client-identity headers
- Fixed context compaction so canonical session history is preserved
- `str_replace` edits now report accurate diffs
- Fixed a performance issue where listing sessions could hang the extension host

## 0.0.58

- `read_files` now tolerates malformed input from weaker models: line-range entries (`start_line`/`end_line`) sent as separate array items are coalesced back onto the preceding file path instead of being rejected

## 0.0.57

- Models in the live catalog that don't report a context window now default to a 128K input-token limit (up from 4,096), so under-specified models get a usable context budget
- The default max input-token budget used for context compaction is now 128K
- Added a shared prompt-format helper in `@cline/shared` and simplified runtime host support

## 0.0.56

- Tool calls from weaker models that use slightly-off argument shapes (e.g. a bare string where an array is expected) or malformed/truncated JSON are now coerced or repaired and executed, instead of being rejected before the tools can handle them
- Fixed plan/act mode notices being stripped from outbound prompts
- Added support for surfacing plan/act mode switches to the model

## 0.0.55

- Add Tencent TokenHub as a provider
- Add a compaction strategy setting so you can choose how context compaction works
- Fix first-prompt truncation on high-output models (e.g. MiniMax M3), where a shallow session could auto-compact immediately and reduce the initial task to just the input wrapper
- Use a curated default when migrating legacy provider settings
- Advertise run commands as shell strings
- Refresh the bundled model catalog with the latest provider models

## 0.0.54

- Improve basic compaction token budgeting so context compaction is more accurate
- Preserve error detail and fetch error cause information so failures surface clearer messages
- Preserve failed run error messages instead of dropping them
- Derive model info in the provider/model runtime path for more reliable provider/model handling
- Add ClinePass subscription support to the account service

## 0.0.53

- Show when request cost is covered by the user's Cline subscription
- List ClinePass features in the not-subscribed message
- Added shared marketplace uninstall support
- Shared marketplace install logic through core
- Surfaced plugin-bundled skills
- Capped MCP tool names at 64 characters for OpenAI-compatible providers
- Updated coupon code

## 0.0.52

- Added checkpoints support to the agent runtime
- Added SAP AI Core provider support: stabilized provider setup, bundled provider auth, forwarded provider options to the gateway, aligned provider config, kept model filtering in clients, and added OCA legacy reasoning-effort handling
- Routed LiteLLM model fetches through the SDK and stopped unrelated models from being injected into the LiteLLM model list
- Preserved OpenRouter reasoning-disable semantics and included the session id for OpenRouter prompt caching
- Updated the ClinePass model list live, restored ClinePass models in onboarding, fixed ClinePass error mapping, and scoped the ClinePass URL to the CLI
- Threaded proxy/CA-aware fetch into the SDK inference path
- Persisted Bedrock settings to providers.json
- Repaired exposed provider auth routing and restored provider-request capture wiring lost in the SDK migration
- Added a connector configure path and moved the shared connector catalog into the shared package
- Normalized JSON-like tool inputs by schema and avoided a nullable editor `old_text` schema
- Batched outdated-read rewrites in `MessageBuilder` to preserve provider prefix caches
- Prevented an "ERROR: EMPTY CONTENT" message from appearing when an error occurs
- Added non-interactive command guidance to the agent
- Published SDK sourcemaps
- Refreshed the generated model catalog

## 0.0.51

- Fixed Z.ai model metadata not resolving correctly when using Z.ai models through the Cline provider; aliases now map to the right model metadata and user overrides are preserved

## 0.0.50

- Truncate every tool result by default (including MCP and custom tool output), with tightened `MessageBuilder` limits and tunable `CLINE_MESSAGE_BUILDER_*` env overrides, to keep provider requests within budget
- Cap assistant text in provider messages and count `tool_use` input toward the request budget; protect binary carrier blocks (not just images) from truncation
- Resolve tool names from `tool_result` when the paired `tool_use` is gone
- Add ClinePass provider support (built-in provider, error handling, format compatibility)
- Apply auto-approve toggles immediately in the agent runtime
- Harden parallel tool-call guidance in the system prompt and tool definitions
- Refresh the generated model catalog

## 0.0.49

- Reverted ClinePass recommended-models support, removing the `clinePass` field from the recommended models data

## 0.0.48

- Added ClinePass support and ClinePass models
- Added MCP server support to plugins
- Updated the recommended/fixed model list
- Encouraged parallel tool calls for faster task execution
- Capped tool output ingestion for bash commands and file reads to keep large output within context limits
- Added a bounded media budget for provider requests, plus generic provider-request capture
- Allowed ranged reads on large files
- Fixed apply_patch to fail when a hunk is skipped instead of silently dropping it
- Fixed run_commands to return captured stdout on failure and to coalesce split heredocs
- Fixed search tools to treat zero results as a successful result
- Fixed search output cap and bash executor follow-up issues
- Fixed disabled-reasoning handling for StepFun flash
- Fixed the Hugging Face URL
- Fixed Cline OAuth token formatting in provider config

## 0.0.47

- Added support for overriding the API base URL
- Enforced a production singleton Cline Hub so only one hub daemon runs, and a stale hub is respawned after an upgrade
- Allowed plugin chat commands to submit prompts to the agent
- Fixed truncation of structured tool operation result strings so oversized tool output stays within limits
- Stopped echoing the full command text in run_commands tool results

## 0.0.46

- Added support for configured agents as subagent tools
- Centralized OAuth management into the SDK
- Added Vertex GCP settings configuration
- Fixed the Azure Foundry API version for the CLI
- Fixed an error caused by disabled reasoning on Fable 5

## 0.0.45

- Added support for the Claude Fable 5 model
- Fixed MiniMax M3 thinking controls so they route correctly across gateways

## 0.0.44

- Added support for Vertex AI Application Default Credentials (ADC) with tool use
- Added a global auto-update setting for CLI startup updates
- Fixed empty message content replay for Bedrock
- Cleaned up the OpenAI Codex model list

## 0.0.43

- Added the Cline Hub web app for managing and monitoring agent sessions
- Added plugin uninstall support
- Added skills bundled with plugins, including grouping plugin skills in settings and rule contributions from sandboxed plugins
- Added support for global AGENTS rules
- Added Slack socket mode support and bound Discord sessions to individual message authors
- Synced the Fireworks AI model registry and updated the model catalog to current platform offerings
- Routed custom registered handlers through the agent runtime
- Added a CLINE_PLUGIN_IMPORT_TIMEOUT_MS environment override for plugin import timeouts
- Allowed a baseUrl field for Anthropic vendor-type providers
- Fixed SAP AI Core to use the AI SDK community provider
- Fixed the hub daemon to stay alive on runtime abort
- Fixed read-files tool input validation to use a union schema
- Fixed discovery of symlinked SDK skill directories
- Improved Cline provider migration
- Fixed OTEL variable bundling
- Added telemetry for run_commands timeouts

## 0.0.42

- Supports Bedrock bearer API keys, direct IAM credentials, AWS profiles, and the default AWS SDK credential chain
- Routes Z.AI GLM thinking through provider metadata while preserving generic thinking suppression for non-GLM Z.AI custom models
