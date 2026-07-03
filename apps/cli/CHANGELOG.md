# Cline CLI Changelog

## 3.0.35

- ClinePass is now enabled for all CLI users
- Recover missing interactive sessions when reading messages
- Format structured commands in history export
- Add the subscription promo code when linking to the dashboard subscription page
- Add Tencent TokenHub as a provider (from SDK v0.0.55)
- Fix first-prompt truncation on high-output models (e.g. MiniMax M3) that could immediately auto-compact and cut the initial task down to just the input wrapper (from SDK v0.0.55)
- Use a curated default when migrating legacy provider settings (from SDK v0.0.55)
- Advertise run commands as shell strings (from SDK v0.0.55)
- Refresh the bundled model catalog with the latest provider models (from SDK v0.0.55)

## 3.0.34

- Fixed the ClinePass upgrade notice appearing immediately after completing onboarding.
- Improved the wording of the ClinePass onboarding step.
- Streamlined the Cline provider picker by merging the subscription and usage/billing options into one and removing the credits link.

## 3.0.33

- Show a ClinePass subscription URL as a fallback during onboarding so you can still subscribe if the subscription screen can't open automatically
- Hide the ClinePass promo for users who already have a ClinePass subscription
- Use an adaptive plan accent color for ClinePass prompts so they fit the active theme

## 3.0.32

- Improved the ClinePass onboarding experience
- Added an intermediate step before going to ClinePass model selection
- Made the ClinePass subscription screen selectable
- Promoted ClinePass in the startup notice
- Used "ClinePass" as one word consistently and refined the provider UI copy
- More accurate context compaction and clearer error messages (from SDK v0.0.54)

## 3.0.31

- Show when request cost is covered by your Cline subscription
- Prompt to switch to ClinePass when you run out of credits, and list ClinePass features in the not-subscribed message
- Added an option to open the subscription page from the ClinePass options
- Added marketplace uninstall support and surfaced plugin-bundled skills
- Require quoted prompts for one-shot mode
- Capped MCP tool names at 64 characters for OpenAI-compatible providers
- Updated coupon code

## 3.0.30

- Added a token count to the status bar, shown alongside cost
- Added organization-specific error messages
- Added SAP AI Core provider support
- Refreshed the model catalog with the latest provider models
- Preserved OpenRouter reasoning-disable behavior and improved OpenRouter prompt caching
- Routed LiteLLM model fetches through the SDK and stopped unrelated models from appearing in the LiteLLM model list
- Updated ClinePass models live, restored ClinePass models in onboarding, and improved ClinePass error messages
- Threaded proxy/CA-aware networking into the inference path
- Persisted Bedrock settings to providers.json
- Normalized JSON-like tool inputs by schema for more reliable tool calls
- Fixed an "ERROR: EMPTY CONTENT" message that could appear when an error occurred
- Fixed a packaging issue (createRequire) that could break the CLI at runtime

## 3.0.29

- Costs are now hidden for Cline free models
- Fixed Z.ai model metadata resolution for Z.ai models accessed through the Cline provider
- Reverted the model-name-only display change from v3.0.28; the model picker, selector, and status bar return to their previous display behavior

## 3.0.28

- Added a ClinePass onboarding flow with selectable ClinePass models, plus improved ClinePass error handling
- Added hub primitive catalogs and refreshed the hub dashboard design with a dedicated customizations breakout
- Auto-approve toggles now apply immediately when changed
- Feature flags now resolve using your user ID on startup
- Fixed Cline model display names so they resolve by model name
- Truncate large tool results by default (including MCP and custom tool output) to keep requests within context budget
- Hardened parallel tool-call guidance for faster, more reliable multi-tool execution

## 3.0.27

- Added a `cline skill` command to install and manage skills, matching `cline plugin install` and `cline mcp` (installs default to the Cline agent directory)
- Added a prefilled MCP install wizard command for quicker MCP server setup
- Improved error handling and messaging when plugin MCP OAuth authorization fails
- The CLI now rejects unknown commands and unquoted multi-word input with a clear error instead of silently treating bad arguments as a prompt

## 3.0.26

- Reverted the expandable model picker sections and ClinePass models, restoring the previous model-selection UI

## 3.0.25

- Added ClinePass support, with selectable ClinePass models in the model picker
- Made model picker sections expandable
- Added MCP server support to plugins, including authorizing plugin MCP OAuth during install
- Encouraged parallel tool calls for faster task execution
- Capped tool output for bash commands and file reads to keep large output within context limits
- Allowed ranged reads on large files
- Fixed apply_patch to fail when a hunk is skipped
- Fixed run_commands to return captured stdout on failure and handle split heredocs
- Fixed search tools to treat zero results as success
- Fixed disabled-reasoning handling for StepFun flash
- Fixed history resume rendering isolation
- Fixed the Hugging Face URL
- Fixed Cline OAuth token formatting in provider config

## 3.0.24

- Plugin commands can now submit prompts to the agent
- Added support for overriding the API base URL
- Open the verification URL automatically when starting device authentication
- Enforced a single shared Cline Hub, so a stale hub is respawned after an upgrade
- Suppressed flickering console windows on Windows
- Fixed truncation of structured tool operation result strings so oversized tool output stays within limits
- Stopped echoing the full command text in run_commands tool results

## 3.0.23

- Fixed Vertex AI GCP settings configuration
- Fixed the Azure Foundry API version
- Added support for configured agents as subagent tools
- Centralized OAuth management into the SDK
- Fixed an error caused by disabled reasoning on Fable 5

## 3.0.22

- Added support for the Claude Fable 5 model
- Fixed MiniMax M3 thinking controls so they route correctly across gateways

## 3.0.21

- Added a global auto-update setting that controls automatic updates on CLI startup
- Added a Cline credits refill link
- Fixed scrolling for inline ask-question responses
- Fixed connector thread session routing and stale hub session handling
- Added support for Vertex AI Application Default Credentials (ADC) with tool use
- Fixed empty message content replay for Bedrock
- Cleaned up the OpenAI Codex model list

## 3.0.20

- Installed plugin wrappers are now named from their source (npm package name, git repo, remote filename, official slug, or local directory) instead of an opaque hash, making installed plugins easier to identify.

## 3.0.19

- Fixed CLI auto-update to use `npm update` so updates apply reliably, while preserving the installed release channel (e.g. nightly).

## 3.0.18

- Fix Slack channel mentions so replies post in the original message's thread.
- Fix the abort indicator to clear immediately when a task is cancelled.
- Sync the Fireworks AI model registry and refresh the bundled model catalog with current platform offerings.
- Bump the bundled SDK to v0.0.43, which forces a running Cline Hub to restart so it picks up the latest SDK code.

## 3.0.17

- Fix a regression introduced in 3.0.15 where the interactive CLI could get stuck after stopping and restarting Cline Hub and then pressing Escape to cancel a request. The CLI now detects stale or missing sessions, recovers any pending messages, and starts a fresh session instead of failing with "session not found".
- Fix Ctrl+C and Hub shutdown races that surfaced as "hook dispatch failed" and WebSocket connection errors from late hook events racing against Hub shutdown.
- Fix the Hub daemon being shut down prematurely when a runtime request was aborted, so the daemon now stays alive.
- Improve the Telegram connector with a new `--allowed-user-id` flag to restrict which Telegram users are authorized to interact with the agent.

## 3.0.16

- Install official Cline plugins by slug off the new github.com/cline/plugins collection.
- Uninstall plugins using `cline plugin uninstall <plugin>` or in the TUI.
- Plugins can now bundle skills, and plugin skills are grouped together in settings.
- Add Slack socket mode support.
- Allow a custom base URL for Anthropic vendor-type providers.
- Fix OAuth token migration for users signed in through the old extension.
- Use a union schema for read-files tool input validation.
- Add a `CLINE_PLUGIN_IMPORT_TIMEOUT_MS` env override to control the plugin import timeout.

## 3.0.15

- Add Cline Hub, a web app for monitoring connected clients, viewing and driving sessions, streaming assistant output, and restarting the local hub, with local, LAN, and tunnel usage gated by a room secret.
- Support global AGENTS rules so agent rules can be applied across all sessions, not just per-project.
- Let plugins contribute static or dynamic rule content when installed in the sandbox.
- Bind Discord sessions to individual message authors so different Discord users no longer share chat state in a thread.
- Support participant mute targets in Discord: resolve `/mute` and `/unmute` from user mentions or raw user IDs to mute a specific participant in a thread.
- Make OAuth URLs clickable in the TUI.
- Refresh the bundled model catalog, adding Claude Opus 4.8, Moonshot Kimi K2.6, and Qwen3.7 Max (with cache support).
- Discover SDK skill directories that are symlinked, including handling circular symlinks.
- Steer active connector sessions across turn keys by matching on session ID, so replies continue the existing session instead of starting a duplicate.
- Stop the Discord connector after repeated identical errors (per thread, within a time window) to prevent error messages from flooding a channel.
- Fix Discord connector registration and reply fallback handling.
- Fix SAP AI Core to use the AI SDK community provider.
- Log ACP output as diagnostics instead of errors so normal output no longer appears as errors.

## 3.0.14

- Fix OTEL telemetry variable bundling so telemetry is correctly enabled in compiled CLI builds: guard against environments where `process.env` is undefined and remove optional chaining so bundlers can inline the values at build time.

## 3.0.13

- Show a loading dialog while resuming a session from history so the TUI no longer appears frozen during the load.
- Speed up the `/clear` command by deferring new session creation until you send the next prompt, so clearing no longer blocks on spinning up an empty session.

## 3.0.12

- Show a loading dialog while the config screen switches provider or model so the transition no longer looks frozen.
- Render the ask question tool prompt inline with the conversation so the question and suggested answers stay attached to the assistant turn that asked them, instead of appearing in a separate modal.
- Allow manual `cline update` runs to install the latest published version immediately, bypassing the release age gate that delays automatic updates.
- Refresh the bundled SDK to 0.0.42, updating the model catalog.

## 3.0.11

- Fix a regression in the ChatGPT OAuth provider where requests failed with `max_output_tokens not supported`, by restoring the full output token budget instead of applying an implicit cap.
- Hide the `Space toggle` hint in the config footer when the highlighted row is not toggleable (rules, agents, hooks).
- Authenticate Vertex Gemini through Google auth when `gcp.projectId` is configured, and surface the full Vertex model list instead of only Claude models.
- Include tool names in tool result content blocks so message logs and session history consistently track which tool produced each result.

## 3.0.10

- Install plugins from `file://` URLs in addition to npm and git sources.
- Show Ollama API key note in TUI settings so users know when to provide an API key.
- Keep interactive sessions alive when idle or awaiting approval instead of treating them as ended, and stop reading message files for every session when `hydrate: false`.
- Add Poolside as a provider.
- Add Gemini 3.5 Flash to the Gemini provider model list.
- Auto-detect Telegram bot username from the bot token so the Telegram connector no longer requires it to be configured separately.
- Notify connectors when a scheduled execution fails, not just when it succeeds.
- Bake OTEL telemetry variables into the CLI at build time so telemetry works in nightly and production builds.
- Preserve model output token limits from the SDK model catalog so context window math matches the upstream provider.
- Soften the visual treatment of rejected tool calls in the TUI.
- Hide the skills tool from the system prompt when skills are disabled, and refresh slash commands after toggling a skill.
- Restore AWS Bedrock profile-based auth during legacy config migration so profiles set via `awsAuthentication: "profile"` are preserved without `awsUseProfile`.
- Cache global settings reads keyed by file mtime so repeated reads skip the JSON parse and zod validation on the hot path.

## 3.0.9

- Speed up CLI startup with plugins by loading sandboxed plugins concurrently and caching plugin tool descriptors per plugin, provider, and model.
- Speed up plugin and tool config toggles by updating the TUI optimistically and persisting changes without reloading the full config or reimporting plugins.
- Restore fuzzy ranking for the @-mention file picker so the most relevant files appear first.
- Keep the interactive CLI session alive after cancelling a task instead of tearing the session down.
- Accept dash-prefixed prompts when passed after `--`, so prompts starting with `-` are no longer parsed as flags.
- Recover from hub abort cleanup failures so a cancel that hits an error no longer crashes the runtime host.
- Route GLM thinking through provider metadata so thinking-enabled GLM models behave correctly through the gateway.

## 3.0.8

- Use Telegram numeric participant ids so renamed users stay linked to the same participant in the Telegram connector.
- Keep failed plugins visible in the config UI with their load/setup phase and error details so broken plugin definitions are easier to diagnose.
- Move the Create Session Fork shortcut from Opt+F to Opt+R so terminal word-right navigation works again.
- Fix AWS Bedrock region and profile detection in the CLI onboarding, and surface bearer-token and additional Bedrock config fields in the provider config screens.
- Fix inflated token usage counts caused by AgentRuntime.execute() not resetting usage between calls, which the local runtime host was then double-counting on top of the session baseline.

## 3.0.7

- Skip the ChatGPT OAuth model refresh on session startup so the CLI launches without the extra network round-trip.
- Align the ChatGPT OAuth model catalog with the Codex provider list so the available models match the subscription tier.

## 3.0.6

- Fix ChatGPT provider model list to include the codex variants and the gpt-5.2, gpt-5.4, and gpt-5.4-mini subscription models.

## 3.0.5

- Show plugin-provided tools and slash commands in the CLI settings dialog by hydrating them through the sandbox.
- Preserve hydrated plugin tools and config reload options when toggling settings, so they no longer disappear after a toggle.

## 3.0.4

- Improve light theme TUI colors so chat, status bar, tool output, and syntax highlighting render with better contrast on light terminals.
- Fix plugin tools failing in the production npm build by bundling the SDK deps plugins import at runtime.

## 3.0.3

- Add `--worktree` flag that auto-creates a fresh git worktree under `~/.cline/worktrees/` and runs the task there. Works with `--taskId` and `--continue` so you can resume a task in an isolated worktree to try a different approach.
- Show session status in the CLI history view and refresh status rows in place while the standalone history TUI is open.
- Restore the OpenAI compatible provider in the auth flow and preserve stored model metadata when configuring or migrating OpenAI-compatible providers.
- Fix dropped macOS screenshots when pasting them into the TUI or asking the agent to read them: paths containing U+202F (narrow no-break space) and other Unicode variants now resolve to the real file instead of failing with ENOENT.
- Accept bearer token auth for AWS Bedrock and map AWS profiles correctly when configuring the Bedrock gateway.
- Honor `--thinking none` for Ollama models that ship with reasoning enabled by default.
- Recover from detached hub event errors instead of crashing the session.
- Refine the shared system prompt with clearer guidance on tool output formatting, unsupported file reads, long-running shell commands, and final verification before completing a task.

## 3.0.2

- Fix token count display showing inflated numbers in the TUI.

## 3.0.1

- Fix CLI release cleanup scripts so they work correctly on Windows.
- Fix the kanban migration notice wording in the TUI.

## 3.0.0

Introducing our new Cline CLI built on our new SDK and comes with a snappy new TUI.

Install:

```sh
npm install -g cline
```

For nightly builds:

```sh
npm install -g cline@nightly
```

## 0.0.13

- Detect prompt-cache support from cache write pricing so providers with write-only caching are represented correctly in the model catalog
- Dual-publish `@clinebot/cli` mirror wrapper so existing users who installed via `npm i -g @clinebot/cli` continue receiving updates
- Fix response truncation for OpenAI Codex model responses

## 0.0.12

- Fix markdown rendering in the published binary: headers, inline code, blockquotes, bold, italic, and lists now render with proper syntax highlighting (tables were the only element working before)
- Add keyboard shortcuts for scrolling through the chat transcript (Page Up/Down, Home/End)
- Preserve typed input when selecting slash command skills instead of clearing the prompt
- Fix `--thinking none` being ignored when persisted reasoning settings existed, which caused DeepSeek API errors
- Fix terminal cleanup on exit so the summary prints cleanly
- Fix onboarding provider model resolution
- Hide ChatGPT subscription provider usage costs
- Handle file index prewarm timeouts gracefully instead of hanging

## 0.0.11

- Add `/skills` slash command for browsing and toggling available skills interactively
- System prompts from AI SDK are now passed via the dedicated `system` option instead of being embedded in message history
- Context compaction can now be triggered manually and runs more reliably
- Disable the search tool in yolo mode so the model uses bash for searching instead
- Fix `submit_and_exit` completion policy not being wired through to the runtime
- Fix resumed sessions losing tool results when an abort interrupted tool execution mid-turn
- Fix interactive sessions becoming unusable after aborting a running turn
- Fix strict JSON schema mode rejecting valid tool schemas with unions, optional fields, and nullable types
- Fix stray log output appearing over the TUI when the log file fallback wrote directly to the stderr file descriptor, bypassing the TUI's stdio capture
- Refresh the built-in model catalog with the latest available models and pricing

## 0.0.10

- Improve local provider onboarding: setting up Ollama, LM Studio, or other local providers now prompts for the endpoint URL directly, supports typing a model ID manually when the provider returns no models, and correctly discovers models from your saved endpoint
- Ctrl+C no longer cancels a running turn -- it now clears the input field or exits the CLI, matching standard terminal behavior. Use Escape to cancel a running turn instead
- Thinking level chosen in the model picker now persists across CLI restarts instead of resetting to off
- The context bar now shows visible progress as tokens are used, instead of appearing empty on some terminal themes
- The status bar token count now shows actual context window usage instead of over-counting across multiple model calls in a turn
- Resuming a saved session now correctly displays the accumulated cost
- Sessions are now saved to disk after each assistant response, so conversation progress survives crashes or unexpected exits
- Auto-compaction now runs inline during model requests, keeping long conversations within the context window automatically
- The home screen robot now follows the cursor while you type
- Hub websocket connections now automatically reconnect after going idle, so sessions no longer silently lose their connection to the hub daemon
- MCP stdio servers on Windows no longer spawn visible console windows
- Tool input schemas containing `allOf` clauses are now handled correctly instead of being rejected
- Login now uses device auth exclusively
- Fix chat input and chat view text losing its indent on wrapped lines

## 0.0.9

- Fix stray text appearing over the TUI when background operations (like hub restart messages) write directly to stdout/stderr during interactive sessions
- Fix hub connection recovery: when a newer CLI instance restarts the shared hub daemon, already-running CLI sessions now automatically reconnect to the new hub endpoint instead of failing with transport errors

## 0.0.8

- Fix crash when pressing Escape to cancel a running turn
- Add plugin and SDK tool toggles to the settings panel
- Add `@cline/sdk` as a user-facing alias for `@cline/core`
- Improve hub recovery with better error handling, logging, and recovery timeouts
- Show session summary (ID, model, cost, resume command) on exit
- Fix OAuth browser-launch failure
- Fix compact no-op being reported indistinctly
- Fix CLI history resume being non-transactional (could leave blank UI or corrupt session on disk)
- Fix cross-client session history not loading Code/VS Code sessions, and fix interactive turn status showing stale state
- Fix configuration file paths for hooks and rules (now resolve from `~/.cline/hooks` and `~/.cline/rules`)
- Fix Telegram connector: honor `--no-tools` flag, lock tool-disabled mode across state changes, post replies as raw text to avoid markdown parse failures, add `/help` and `/start` commands
- Clean up CLI program description and compact slash command descriptions
- Clean up CLI flags

## 0.0.7

- Fix graceful recovery when the model returns malformed tool call inputs, preventing crashes mid-conversation
- Add settings toggles for core skills (enable/disable individual skills from the settings panel)
- Secure the local hub daemon with a discovery auth token, preventing unauthorized local access
- Fix auto-approve tool policies being incorrectly reset after session restore
- Fix npm wrapper detection for auto updates, so self-update works when the CLI is invoked through npm/npx shims
- Improve fork session UX with clearer prompts and smoother flow
- Fix manual thinking budget not being applied when using Anthropic models directly
- Improve account onboarding flow with better error messages and step sequencing
- Add enable/disable controls for individual tools and plugins
- Fix abort handling so the public run promise resolves correctly when a run is cancelled
- Fix markdown token styling in chat output
- Fix chat auto-scrolling to bottom on message submit
- Fix hub tool capabilities being routed to the wrong session
- Revert loading extension-created sessions from history (was causing issues)

## 0.0.6

- Add checkpoint restore: press Esc twice or type `/undo` to rewind to a previous checkpoint, with options to restore chat only or chat + workspace
- Fix clipboard: fall back to system clipboard (pbcopy, PowerShell, wl-copy, xclip) when OSC 52 fails, fixing copy for longer text selections
- Fix prompt focus: restore focus to the prompt input after dialogs close, preventing the input from becoming unresponsive after using `/settings`

## 0.0.5

- The input field has been completely redesigned -- the old bordered box is replaced with a clean chevron-prompt style that adapts its background color to any terminal theme using perceptual OKLAB color math. Light terminals are fully supported now.
- Pasting 5+ lines into the input shows a compact preview marker instead of flooding the textarea. The full content is still submitted.
- Arrow-key history navigation respects cursor position so you don't lose your place when scrolling through previous prompts.
- The TUI renders immediately instead of blocking while the hub daemon boots. Hub readiness and session hydration happen in the background.
- Listing previous sessions no longer hydrates every full session, making `cline history` and the history picker snappy even with hundreds of sessions.
- Updating the CLI no longer leaves you connected to a stale hub daemon. Incompatible versions are detected and replaced automatically, eliminating the "Unsupported hub schedule command" class of errors.
- Schedules can now trigger on external events (webhooks, GitHub events, plugin-emitted signals) in addition to cron intervals, with deduplication, filtering, and retry policies.
- Plugins can register automation event types that feed into the scheduling system, enabling custom triggers from any source.
- Resuming a session automatically picks up any in-flight team runs without needing to remember or pass `--team-name`.
- `providers.json` (which stores API keys and OAuth tokens) is now written with 0600 permissions, preventing other processes on the machine from reading it.
- Models that emit `command` or `cmd` instead of `commands` (or `paths` instead of `path`) no longer fail. Common aliases are normalized before execution.

## 0.0.4

- Fix compiled binary spawning infinite hub daemon recursion loop

## 0.0.3

- Rewritten TUI from Ink to OpenTUI with streaming markdown, syntax-highlighted diffs, scrollable chat, and mouse support
- Dialog system for model picker, tool approval, settings browser, session history, and onboarding
- Interactive setup wizards: `cline connect`, `cline schedule`, `cline mcp`
- Plan/Act mode toggle with system prompt and tool rebuilding on switch
- Input autocomplete for slash commands and file mentions
- Message queuing and steer messages during running turns
- Platform-specific compiled binaries for macOS, Linux, and Windows (arm64 and x64)
- npm trusted publishing via GitHub Actions OIDC
