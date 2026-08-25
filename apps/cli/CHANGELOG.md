# Cline CLI Changelog

## 3.0.58

- The first-launch "Try ClinePass" dialog no longer advertises the $4.99 first-month promo, which is ending
- The hub's event log is now capped at 64 MiB on disk. Events carrying full session snapshots could previously grow the log to tens of gigabytes on a long-running hub, since deleting rows never shrinks the file. Oldest events are dropped first and the space is returned, and pruning runs on volume as well as on a timer
- Refreshed the model catalog. Adds two providers (AgentRouter and Opper) and updates model lists and pricing across providers. The resolved default model changes for Aki.io and NanoGPT, so if you use one of those without pinning a model you will get a different default

## 3.0.57

- Added `cline hub drain`, which stops a hub from accepting new mutating work while it finishes what it is already running, and `cline hub drain --off` to lift it
- Added `cline hub upgrade`, which drains the hub, waits for it to go idle, stops it, and starts a fresh one on the current build. An aborted upgrade lifts the drain again, so the hub is never left refusing work
- Sessions now survive a hub restart. A reconnecting client replays the events it missed while disconnected, deduped by event id so nothing is delivered twice
- Fixed tool calling being silently disabled for custom OpenAI-Compatible models whose capability list was inferred from convenience flags like `supportsReasoning`. The inferred list read as an authoritative denial and stripped every tool from the request
- Langfuse traces now carry session and client identity for hub-backed and delegated-agent runs, instead of arriving without their session grouping or client version
- Refreshed the model catalog, which updates model lists and pricing across providers and changes the resolved default model for several of them (DeepSeek, Crof, CrossModel, Eden AI, Kilo, and NanoGPT)

## 3.0.56

- Models that support image generation can now produce media during a turn. The TUI saves each generated file to a temporary path and prints it so you can open it with your usual tools, HTML session exports embed images inline, and ACP clients receive generated images as image content
- Skill slash commands now load through the skills tool instead of expanding into your message. History and resume show the `/command` you typed instead of the whole skill body, and the instructions reach the model once instead of twice. Workflows still expand, as does zen mode, whose preset has no skills tool
- Image, voice, and other non-chat models are no longer offered in the onboarding and model pickers or ACP model listings, and are rejected for `--model`
- Fixed TUI dialog colors not following theme changes live
- Fixed the account dialog's selection chevron so it matches the other dialogs
- Fixed provider-executed tool activity — every tool the Claude Code provider runs inside its own session — being dropped instead of shown as a tool card
- Fixed `PreToolUse` hook `contextModification` never reaching the model, and `PostToolUse` hooks running fire-and-forget with their output and `cancel` control discarded
- Fixed `run_commands` failing with ENOENT when a structured command carried a full command line with no `args`
- PowerShell commands now fail fast on the first error instead of emitting an error record per enumerated item and still reporting success
- Fixed Gemini custom base URLs configured as a host root
- Fixed `cline schedule` commands against a remote hub, which now register a workspace client so they are authorized under the new workspace-scoped schedule rules
- Usage now displays the billed gateway cost
- Refreshed the model catalog, which adds AMD, Arcee, Echo, Jalapeno, Kosmik, LLM Gateway, RunInfra, and SCNet as providers and updates model lists, pricing, and per-provider default models across the board

## 3.0.55

- Auto-updates no longer install while a CLI is attached to the Hub. The update is recorded at startup and installed on exit, once the Hub confirms nothing else is attached, so a background update can no longer swap the package out from under a live session and kill it with `Hub connection closed (code=1006)`. `cline update` still installs immediately and now tells you the update applies on next start
- Added protections for an update landing under CLI 3.0.54 and earlier, whose updater restarts the Hub mid-session and then rejects every replacement, bricking a running session. The newly installed package defuses that path during install instead of leaving it to fire
- Fixed two Cline installations on different builds shutting each other's Hub daemon down in a loop, which killed every live session with an abnormal socket close. Build identity is now compared through a total order, so at most one side of a pair can ever decide to retire the other (from SDK v0.0.75)
- A newer build no longer replaces a Hub that is still serving sessions — it attaches to it and the swap happens on a later launch, instead of the sessions dying mid-handshake (from SDK v0.0.75)
- Removed the "outdated Hub" notice. It reported a state you cannot act on, and the toast was capped narrower than the message, so it rendered cut off before the reassuring half of the sentence at every terminal width. The prompt for a genuine build mismatch, where there is something to do, is unchanged
- Streaming assistant markdown no longer flashes back to raw text. Settled headings, links, and code stay rendered as new chunks arrive instead of the whole message being rebuilt and re-highlighted on every chunk, which also stops the transcript from jumping vertically mid-stream
- Web search calls and their results from models that run search natively now render in the transcript (from SDK v0.0.75)
- Idle plugin sandbox processes are now reclaimed instead of lingering for the life of the session (from SDK v0.0.75)
- `cline doctor fix` now reports honestly: processes that survived a kill are separated from ones that appeared while the fix ran, a live parent respawning a daemon is named, and a startup lock held by a running process is reported as held rather than leaked (from SDK v0.0.75)
- Refreshed the model catalog, which adds Crusoe as a provider and updates model lists and per-provider default models across the board (from SDK v0.0.75)

## 3.0.54

- Fixed the Claude Code provider being unusable for agentic work: the provider now runs its own native tools instead of receiving tool definitions it cannot bridge, the session is anchored on your workspace directory instead of inheriting the host's cwd, and `~/.claude` plus project settings are loaded so your permission rules apply. File edits under the workspace are auto-approved; command execution stays gated by your own Claude settings (from SDK v0.0.74)
- Fixed truncated tool-call JSON being silently "repaired" into wrong arguments — a payload with an unterminated string is now rejected rather than getting an invented terminator (from SDK v0.0.74)
- Fixed strict providers rejecting a turn with "user message must have content" when a message's content held only empty text parts (from SDK v0.0.74)
- Fixed a mid-turn crash on streamed tool calls with non-zero or non-contiguous indexes, hit through LiteLLM's Anthropic passthrough (from SDK v0.0.74)
- Managed Hub daemons now upgrade directionally: when another Cline install ships a newer Hub build, the CLI attaches to the newer daemon and prompts you to update and restart instead of the two installs repeatedly retiring each other's daemons. Yolo and sandbox sessions, which never attach to the shared Hub, are not interrupted by that prompt (from SDK v0.0.74)
- Fixed the Hub daemon logging an unhandled `hub server close failed` error and exiting non-zero whenever a client was still connected at shutdown (from SDK v0.0.74)
- Fixed per-task token totals being inflated roughly 5x on cache-heavy sessions — token telemetry now reports disjoint uncached-input, cache-read, and cache-write buckets instead of re-counting the whole cached conversation on every request (from SDK v0.0.74)
- Upgrading the CLI now retires an already-running Hub daemon and respawns it on the new code, instead of the upgraded CLI continuing to talk to a daemon executing the previous release

## 3.0.53

- Fixed the CLI reconnecting to a stale Hub daemon after an upgrade. Hub daemons now carry a runtime build fingerprint, so an upgraded CLI retires and respawns a daemon still running older code instead of attaching to it (from SDK v0.0.73)
- Fixed compaction being silently skipped on reasoning models. The summarizer no longer hardcodes a 1024-token output cap — it honors your max output tokens setting, defaults to 4096 (lowered when the model reports less), and logs a diagnostic when a summary comes back empty (from SDK v0.0.73)
- Added Fable 5 (`claude-fable-5`) to the Vertex model catalog. Pricing is intentionally omitted because Vertex bills region-dependently, so cost shows as unknown rather than wrong (from SDK v0.0.73)
- Custom Vertex model IDs are now passed through unchanged, routing Claude-style IDs to the Anthropic-on-Vertex path (from SDK v0.0.73)

## 3.0.52

- Added `cline mcp uninstall` for removing an installed MCP server
- Schedules now reuse your saved provider settings instead of needing provider configuration of their own
- Queued messages are legible on light-theme terminals — they were previously rendered in a color that washed out against a light background
- MCP tool results render as readable text in the TUI instead of escaped JSON, and binary payloads survive being expanded instead of being mangled
- Malformed tool input/output payloads no longer break rendering — the formatters degrade gracefully instead of throwing
- Prompts queued during a turn now survive being interrupted: they are preserved across aborts, drained after a turn aborts itself, and the stop is surfaced instead of leaving the queue silently dropped (from SDK v0.0.72)
- Session context stays durable across aborts and hub restarts, so an interrupted session resumes with the state it had (from SDK v0.0.72)
- A hung MCP server no longer takes down session creation, and stdio servers that were never configured get a 30-second initialize budget instead of blocking indefinitely (from SDK v0.0.72)
- Remote SSE MCP servers surface an OAuth authorization prompt on a 401 instead of failing outright, and pre-registered OAuth clients are supported for setups without dynamic client registration (from SDK v0.0.72)
- LiteLLM requests route through Chat Completions instead of the Responses API, fixing calls against LiteLLM proxies (from SDK v0.0.72)
- Network interruptions that happen mid-stream but before any model output are retried instead of failing the turn (from SDK v0.0.72)
- Vertex ADC token refreshes use the configured fetch, so they work behind proxies and custom transports (from SDK v0.0.72)
- Checkpoint diffs include files that were untracked when the snapshot was taken, and checkpoints are picked up when git is initialized part-way through a session (from SDK v0.0.72)
- Scheduled run reports carry execution context — readable headers, schedule metadata, durations, and lifecycle error details (from SDK v0.0.72)

## 3.0.51

- Reasoning effort now applies consistently across providers instead of going through per-provider thinking overrides, including Ollama, and asking for reasoning to be off is respected everywhere (from SDK v0.0.71)
- `meta/muse-spark-1.2-contributor` is now selectable on the Cline provider, alongside a refreshed model catalog (from SDK v0.0.71)
- Error telemetry now reports the model that was actually in use for the run (from SDK v0.0.71)

## 3.0.50

- Added user-selectable color themes to the interactive TUI. Pick one with `/theme`, the command palette, or the Theme row in `/settings` — the picker previews each theme live. Built-in themes are Auto (terminal-adaptive, the default), Cline Dark, Cline Light, Tokyo Night, Gruvbox Dark, Nord, Dracula, Catppuccin Mocha, One Dark, Solarized Dark, and Solarized Light. Named themes paint the background, foreground, accents, syntax highlighting, and diff colors, and `CLINE_THEME` overrides the persisted choice at startup
- The git branch shown below the prompt now updates when you switch branches from another terminal or your editor, instead of showing whatever was checked out when the TUI started
- Telegram slash commands such as `/clear` now reach the connector command host — the Telegram library was intercepting them and they were silently dropped
- Racing connector launches no longer collide: an instance is claimed before it opens socket mode, the hub supervises connector processes, and `doctor`/`connect` skip connectors that are already starting. Connector tools are also enabled by default, and the Slack greeting is no longer replayed on reconnect
- Auto-approval settings are now honored over ACP
- Plan mode now hard-blocks file-editing shell commands instead of relying on prompting alone — `run_commands` stays available for read-only investigation, but file-manipulation commands, in-place editors (`sed -i`, `perl -i`), redirection to files, mutating git subcommands, package installs, and nested command strings (`sh -c`, `eval`, `sudo`) are rejected, on Windows and PowerShell too (from SDK v0.0.70)
- A turn that ends with a completed plan is no longer rendered as a failed turn when a plan-blocked command was its only tool call
- Running out of context is now recovered from instead of failing with a raw provider error: the run force-compacts and retries once, and the cases that genuinely cannot be recovered report why (from SDK v0.0.70)
- Empty model responses are now retried on every provider, not just Ollama — OpenRouter, Cline, and OpenAI-compatible endpoints previously failed the task outright with "Model returned empty response" (from SDK v0.0.70)
- Claude 4.6+ and 5.x models are no longer rejected with "thinking.type.enabled is not supported" when they resolve from the offline catalog or from a hand-typed model id (from SDK v0.0.70)
- Bedrock prompt caching works again — the provider was sending a cache format Bedrock silently discards, so cache reads and writes were always 0 — and Bedrock foundation models are now routed through geo inference profiles (from SDK v0.0.70)
- Reasoning models on OpenAI-compatible endpoints now receive `max_completion_tokens` instead of the rejected `max_tokens`, and requests to models without image support substitute the image content instead of failing (from SDK v0.0.70)
- MiniMax now inherits its default model from models.dev, and the model catalog picked up two new providers, Infomaniak and SCX.ai (from SDK v0.0.70)
- Upgraded the model layer to AI SDK 7 and switched Ollama to the native AI SDK provider (from SDK v0.0.70)
- Error telemetry no longer reports the same provider failure twice, and repeated failures from unattended retry loops are rate-limited (from SDK v0.0.70)

## 3.0.49

- `/undo` works again once the agent has used tools — the checkpoint picker counted tool results as user turns, so restore aborted with "Could not find user message for run N"
- Checkpoints are actually created again; a run-boundary regression meant none were ever recorded in the CLI (from SDK v0.0.69)
- Checkpoint restore is now a full workspace rewind: files Cline created during the task come back at their checkpoint-time content and files created after the checkpoint are removed, while `.gitignore`d paths (build output, `node_modules`, `.env`) are left alone (from SDK v0.0.69)
- After a restore, the rewound message is prefilled as plain text instead of the raw `<user_input mode="act">` envelope
- Ollama's response-start timeout is now 5 minutes instead of 30 seconds, so cold-loading a large local model no longer errors out mid-load (from SDK v0.0.69)
- Empty Ollama responses are now retried instead of failing the task with "Model returned empty response" (from SDK v0.0.69)
- Migrated users whose stored Cline model id isn't in the catalog now fall back to the default model instead of sending an unknown model id on every request (from SDK v0.0.69)
- The ClinePass promo dialog can be dismissed with any key (Enter still opens the subscription page), and it is marked as shown when it appears, so force-quitting no longer replays it on every launch
- Opening a URL no longer crashes the CLI on hosts without an opener binary (headless Linux without `xdg-open`); WSL2 containers now use `xdg-open`, Windows tries the absolute PowerShell path first, and `cline doctor log` converts Linux paths to `\\wsl$` UNC paths
- The hub now restarts through the installed wrapper after a Unix self-update, so npm cannot reuse a deleted cached executable
- ACP: ClinePass is selectable as a provider, organizations can be selected, session resolution and text rendering on session restart are fixed, and agent errors now describe the actual failure
- Provider errors forwarded through the Vercel AI Gateway now surface the real upstream message instead of a raw Zod dump or `[object Object]` (from SDK v0.0.68)
- Cline free models and recommended models now show their real display names in the model picker (from SDK v0.0.68)
- Sessions rooted at the filesystem root (`/`) no longer fail every command (from SDK v0.0.68)
- On Windows, PowerShell commands now travel over UTF-8 stdin, so non-ASCII commands survive the active code page and long commands are not capped by the command-line limit (from SDK v0.0.68)
- The live model catalog no longer drops the video input capability (from SDK v0.0.68)
- Removed the CLI promo code flow

## 3.0.48

- `cline history` now opens inside the existing TUI, with resume and delete actions, instead of rendering a second view in the same process
- Connector threads (Slack, Discord, Telegram, Linear, Google Chat, WhatsApp) now recover when the session they were bound to is gone — the stale binding is dropped and the turn replays against a new session, instead of failing with "session not found" until `threads.json` is edited by hand
- `cline --help` now reports the real default `--config` and `--data-dir` paths
- The per-server `timeout` in `cline_mcp_settings.json` is now honored for `initialize`, `tools/list`, and `tools/call`, so slow MCP servers no longer fail against a hardcoded 5s limit (from SDK v0.0.67)
- Reasoning controls are now routed from the models.dev catalog across providers, with clamped budgets and correct per-provider encoding (from SDK v0.0.67)
- OpenRouter now defaults to `anthropic/claude-sonnet-5` (from SDK v0.0.67)
- Fixed the China and international endpoint toggles being ignored for Qwen, Moonshot, and Z AI (from SDK v0.0.67)
- Legacy API keys are now migrated for every secret-backed provider (from SDK v0.0.67)
- Legacy OpenAI Compatible model-info overrides now survive into the seeded `models.json` (from SDK v0.0.67)
- Fixed auto-compaction state being rejected as stale, which added a redundant summarizer call on every turn past the compaction trigger (from SDK v0.0.67)
- Fixed checkpoint restores across session resumes (from SDK v0.0.67)
- Tool calls that pass line numbers as strings (`insert_line`, `read_files` bounds) are now accepted instead of erroring (from SDK v0.0.67)
- A legacy single-file `.clinerules` no longer aborts the config scan (from SDK v0.0.67)
- Plugins can now emit telemetry through `ctx.telemetry` (from SDK v0.0.67)

## 3.0.47

- Free Cline models are now supported end to end: free models show as "(free)", and hitting the free limit renders a dedicated card with the reset time (from SDK v0.0.66)
- `/settings` general toggles (plan/act mode, tool auto-approve, compaction mode) now persist across restarts
- Upgraded the TUI stack from opentui 0.1.102 to 0.4.3
- Fixed a grey panel left behind on screen after closing a dialog (model picker, help, command palette) — a leftover from the opentui upgrade
- Fixed a React duplicate-key warning when `read_files` listed the same path more than once
- Aborting a task no longer risks killing the shared hub daemon
- Connector status delivery failures are no longer fatal to the turn
- Agentic compaction is now the default context-compaction strategy, with fixes for it silently falling back to basic compaction and for tool-heavy transcripts that could never find a cut point (from SDK v0.0.66)
- Editor edits preserve a file's existing line endings, fixing failed exact-match edits on CRLF files (from SDK v0.0.66)
- Broader built-in provider coverage, now generated from models.dev (from SDK v0.0.66)
- Updated the bundled model catalog (from SDK v0.0.66)

## 3.0.46

- Fixed out-of-credits detection so the CLI reliably recognizes the Cline API's real `insufficient_credits` (402) error and shows the "add credits" card instead of a generic error

## 3.0.45

- Smaller install: the Claude Code and Codex providers are now optional and loaded on demand, cutting `npm i -g cline` from ~640MB to ~285MB (from SDK v0.0.65)
- Kimi K3 is now available as a ClinePass model (from SDK v0.0.65)
- Runs now retry once after refreshing expired OAuth credentials (from SDK v0.0.65)
- Team runs: the spawn tool is no longer exposed to teammates, and errored teammate runs now report as failed instead of completed (from SDK v0.0.65)
- Hub status output now includes version numbers
- Updated the bundled model catalog (from SDK v0.0.65)

## 3.0.44

- Improved max output token handling across providers (gateway routing, OpenAI vendor, and reasoning models) (from SDK v0.0.64)
- Frontmatter and configuration files that start with a UTF-8 byte order mark (e.g. saved by Windows editors) now parse correctly (from SDK v0.0.64)

## 3.0.43

- The CLI now automatically trusts your operating system's certificate store, so it works behind corporate proxies and TLS-inspecting firewalls without manually setting `NODE_EXTRA_CA_CERTS` (fixes "unable to get local issuer certificate" errors, including Windows intermediate CA stores)

## 3.0.42

- Fixed Ollama native API routing so context window and timeout settings work again

## 3.0.41

- Compaction now shows progress status in the TUI
- Model IDs are now suggested from OpenAI-compatible endpoints when configuring a provider
- Workspace git info (branch/remote) is now persisted and refreshed across sessions
- Compaction no longer runs during an active turn
- Fixed a crash when the terminal title was updated during TUI teardown
- The API key fallback hint is now highlighted for better visibility
- Benign git states are no longer reported as workspace initialization errors

## 3.0.40

- Added a manual API key escape hatch for Cline OAuth providers, so you can enter a key by hand from settings
- Fixed provider config not reloading when switching models
- Fixed auto-update failing to detect Bun global installs after symlink resolution
- Fixed unexpected logouts caused by transient network or server errors during token refresh
- The ClinePass usage-limit error is now surfaced clearly when you hit the limit
- Session id is now preserved when continuing within the same session
- Hardened context compaction budget handling

## 3.0.39

- You can now select Cline free models on the ClinePass provider in the model picker
- Removed the retired ClinePass GLM 5.1 model
- Fixed OpenAI Codex model metadata under the GPT Subscription provider
- `str_replace` edits now report accurate diffs
- Fixed context compaction so canonical session history is preserved
- The detached hub daemon now emits telemetry, and telemetry identity now includes `user_id`
- Cline provider requests now send versioned client-identity headers

## 3.0.38

- New plan/act accent palette: act mode is now blue (`#79b8ff`) and plan mode amber, replacing the old cyan/yellow — applied across dialogs, the model selector, config, onboarding, markdown, and syntax highlighting, with light-theme variants tuned for contrast
- Restyled chat input: a minimal frame with full-width horizontal rules and a bold accent prompt glyph instead of the tinted background, plus slimmer user-message bubbles
- Assistant markdown accents are now tinted by the mode (plan/act) they were produced in
- Polished the status bar usage display and ClinePass model name
- Harmonized the success/diff green and dark syntax-highlighting colors with the new brand palette
- The thinking-level picker now defaults its cursor to Medium instead of Off
- `read_files` now tolerates malformed input from weaker models: line-range entries (`start_line`/`end_line`) sent as separate array items are coalesced back onto the preceding file path instead of being rejected (from SDK v0.0.58)
- Models in the live catalog that don't report a context window now default to a 128K input-token limit, so under-specified models get a usable context budget (from SDK v0.0.57)

## 3.0.37

- Weaker models (e.g. DeepSeek) that emit malformed tool calls — wrong argument types or truncated JSON — are now handled gracefully and run instead of erroring out
- Plan/act mode switches are now visible to the model, so it knows when you change modes mid-session
- Fixed plan/act mode notices being dropped from prompts sent to the model
- Fixed a race where switching modes in an empty session could trigger an unexpected restart

## 3.0.36

- Fixed plan mode's `switch_to_act_mode` tool not taking effect until the end of the turn: the model would keep running with plan-mode tools (no file editor) and fall back to editing files through shell commands. Switching to act mode now ends the plan-mode run and automatically continues with the approved plan using the full act-mode toolset. A Tab mode toggle racing a completing turn can no longer auto-start plan execution you didn't approve.

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
