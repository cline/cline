# Cline Desktop Changelog

## 0.0.17

- Plugins, MCP, Skills, Rules, Hooks, and Tools are now one Customize hub with tabbed sections and live counts. Catalog-backed tabs show what you have installed followed by an inline Browse section, so installing something from the catalog immediately appears above — the separate Marketplace page is gone
- Redesigned the Models page: providers are grouped into Connected, Popular, and All with their auth kind and configuration status instead of per-row toggles. OAuth providers now offer a browser sign-in rather than an API key field, with a collapsed manual-key escape hatch where supported, and explicit Connect / Disconnect / Sign out actions
- Voice input moved to its own Settings → Voice page that only offers connected transcription-capable providers and preselects a default model. The composer's microphone button now appears only once a voice model is configured
- Sidebar sessions are always grouped by project, with pinned sessions leading each group and scheduled sessions marked by an inline clock. The Favorite action is now called Pin
- New, Schedule, and Customize each got their own labeled row below the logo. New starts a fresh task and puts your cursor straight in the composer
- Session search moved into a dialog behind the search icon in the logo row, and it now searches your full history instead of only the sessions already loaded in the sidebar
- Added suggested schedule templates to the Schedule page
- Add Provider opens a dialog instead of swapping out the page
- Desktop notifications are now a single section under General, so the Event/Notify/Sound matrix no longer reads as a peer of settings like Dark mode
- The agent's todo tool and the Agenda panel have been removed; scheduled tasks are unaffected
- Fixed the provider list being unscrollable while a provider detail panel was open
- Fixed a failed settings save leaving the Models page claiming a provider configuration that was never written to disk
- Fixed Uninstall buttons collapsing to a broken square next to Install
- Fixed unreadable selected text inside input fields
- New files are now created with your platform's native line endings
- Fixed the codebase search tool crashing the app on files containing a single enormous line
- The hub's event log can no longer grow until it fills your disk

## 0.0.16

- The agent can now be handed off between Hub instances without losing work: a Hub that is restarting refuses new work while it finishes what it is running, and the app replays anything it missed while disconnected instead of dropping it
- Fixed tool calling being silently disabled for custom OpenAI-Compatible models whose capability list was inferred from convenience flags like `supportsReasoning`
- Refreshed the model catalog, which updates model lists and pricing across providers and changes the resolved default model for several of them (DeepSeek, Crof, CrossModel, Eden AI, Kilo, and NanoGPT)
- The app now honors server-side feature flags, refreshing them when your account changes

## 0.0.15

- The app is now called Cline, renamed from Cline Code. Your settings, sessions, and credentials carry over untouched — only the name and icon change
- Refreshed app icons and branding
- Reskinned the first-run onboarding, with an interactive welcome graphic
- Plugins, MCP servers, and Skills are now one Plugins hub with a dedicated Marketplace page
- The composer's model selector now leads with Recommended and Free tiers (Subscribed and Free on ClinePass), labeled by display name with descriptions, instead of an alphabetized list of raw model ids. Provider settings show the same badges and descriptions
- Agents can now create and manage durable todos and one-time or recurring schedules
- Fixed checkpoint restore wedging permanently. Sessions that were never prompted — and persistence-only updates — reported a bogus "running" status, so anything gated on an active turn stayed blocked forever
- Fixed "No sessions found" flashing while session history was still loading
- Fixed the work summary undercounting elapsed time when thinking before a tool call attached to the answer instead of the run
- Fixed the settings gear keeping its hover state while the Account screen is open
- Fixed ClinePass not being recognized as OAuth-managed in the chat credential gate, which asked for credentials it already had
- Fixed copying a user message bringing along its internal envelope
- Fixed multi-line code blocks collapsing onto a single line
- Image, voice, and other non-chat models are no longer offered in chat model pickers
- Fixed `PreToolUse` hook `contextModification` never reaching the model, and `PostToolUse` hook output and `cancel` control being discarded
- Fixed provider-executed tool activity — every tool the Claude Code provider runs inside its own session — being dropped instead of shown
- PowerShell commands now fail fast on the first error instead of flooding output and still reporting success
- Usage now displays the billed gateway cost
- Refreshed the model catalog, which adds AMD, Arcee, Echo, Jalapeno, Kosmik, LLM Gateway, RunInfra, and SCNet as providers and updates model lists, pricing, and per-provider default models across the board

## 0.0.14

- The app now posts native macOS notifications when a task finishes or needs your input, so you can leave Cline working in the background. Configure them under Settings → Notifications.
- Voice input: dictate into the composer with the microphone button and your speech is transcribed as you talk, using the provider and model you have configured.
- Commands stream their output into the transcript as they run instead of appearing all at once when the command exits. Output keeps its terminal colors, is scrollable without being yanked back to the bottom, and a long-running command can be sent to the background with "Proceed while running" so the agent moves on while it finishes.
- Models that support image generation can now produce images during a task, and they render inline in the transcript.
- Finished agent runs collapse into a single "Worked for 4m 12s and made 14 tool calls" summary you can expand, so the final answer stays in view instead of being buried under the working rows.
- Reasoning traces and tool rows now open and close with an animation instead of snapping, and respect your reduced-motion setting.
- Redesigned the question card the agent shows when it needs a decision: options are selected explicitly and submitted with a button, multiple-choice questions are supported, and there are arrow-key and A–Z shortcuts. Internal request IDs, iteration counts, and timestamps no longer appear on the card.
- The Web search toggle in Settings now explains that only providers with built-in web search honor it, and shows which of your connected providers are ready to use it — or warns you, with a link to Models, when none of them are.
- Refreshed assistant markdown — chat-scaled headings, quieter code blocks with a hover copy button, and table cards — now rendered through the same pipeline as the rest of Cline, so the desktop app and the cloud dashboard finally look alike.
- Message hover actions float over the transcript instead of reserving blank space under every message, so conversations pack more tightly.
- Restyled session hover cards: they open immediately, drop the duplicated ID and updated time, and no longer animate as you move down the list.
- There is now a separate "Cline Code Beta" app that installs side by side with this one and tracks the experimental branch. It identifies itself as beta in the sidebar, Settings, window title, and tray, so you always know which build you are in.
- Fixed turns that settle through the event stream — queued prompts, and the first prompt of a fresh session — staying stuck on the streaming shimmer with no final output, healing only when you sent another message. The transcript now reconciles against the saved history as soon as the turn ends.
- Fixed sessions being given the Yolo-mode system prompt whenever auto-approve was on, even though the runtime was started in Act mode. Auto-approval is now an independent tool policy and no longer changes the advertised mode.
- `/skill` and `/workflow` commands no longer dump the whole skill body into the chat as your message. Your typed command stays as typed, the model loads the instructions through the skills tool, and sessions are no longer titled with the first line of a skill's markdown. Sessions saved before this fix render compactly too.
- Fixed command execution breaking for an entire session when a model emitted a full command line with no separate arguments — anything containing a space failed with `ENOENT`.
- Restoring a checkpoint now trims the saved transcript too, so the chat no longer keeps showing turns whose file changes were just reverted.
- Gemini custom base URLs work again, including host-root values saved before the SDK migration and proxy roots like `http://localhost:4000/gemini`, which were silently missing the API version segment and 404ing.
- LiteLLM input token limits reported by the server are preserved instead of being replaced with a 128K default.
- Fixed misaligned columns in the Usage table, and added a See More link to the full usage dashboard.
- Fixed routine dialog dropdowns not responding to mouse clicks.

## 0.0.13

- Added an app font size setting. A slider in Settings scales the interface, and your size is applied before the window paints, so launching no longer flashes at the old size first.
- Models that support it can now search the web during a task. Turn it on with the Web Search toggle in Settings; the searches and their results appear in the transcript and are still there when you reopen the session.
- Extended thinking budgets reach the provider again on Cline Pass — they had silently stopped applying when the gateway moved off the generic OpenAI-compatible path.
- Two Cline installs on different builds no longer shut each other's Hub down in a loop, which was killing live sessions with an abnormal disconnect.
- The app no longer replaces a Hub that is still serving sessions. It attaches to it instead, and the swap happens once that Hub goes idle.
- The "update required" dialog no longer interrupts when the Hub is only finishing an update on its own. This app is already the newer build, nothing was being asked of you, and the Hub replaces itself once its sessions end.
- Idle plugin sandbox processes are now reclaimed instead of lingering for the life of the session.
- Refreshed the model catalog, which adds Crusoe as a provider and updates model lists and per-provider default models across the board.

## 0.0.12

- Every tool call now gets its own row in the transcript, with its own icon, status, and expandable detail — no more "Read 3 files · Ran 2 commands" grouping. Commands read like a terminal (`$ bun test`) with their captured output on expand, and edits show their diffs inline, one per hunk.
- Running tool rows are highlighted in brand violet and settle to gray when they finish; errors stay red.
- File diffs — both in chat rows and the diff panel — now render through a shared syntax-highlighted renderer that follows the app's theme instead of the browser's.
- Refreshed session transcript layout, message surfaces, and composer, with new Inter and Geist Mono typography.
- The thinking indicator now stays up during quiet stretches of a turn, such as while tool arguments are streaming, so the turn no longer looks frozen.
- Message actions (copy, fork, timestamp) no longer crowd the message text, and expanded panels render at full opacity instead of faded.
- On the welcome screen the chat input is centered and top-aligned, and prompt suggestions are temporarily hidden.
- The first turn of a fresh session no longer wedges the composer on "Agent is working…" forever.
- Scheduled runs no longer appear in the session sidebar and history list.
- Reconnecting to a stale managed Cline Hub daemon is fixed. When another Cline install ships a newer Hub, the app now prompts to update and restart — and stages the app update first, so it no longer relaunches into the same version and immediately re-prompts.
- The Hub daemon now shuts down cleanly instead of exiting with an error when a client is still connected.
- The Claude Code provider is usable for agentic work again: sessions are anchored on the workspace folder, your `~/.claude` and project settings are loaded, and file edits under the workspace are allowed instead of every write being refused with no approval prompt.
- Truncated tool-call JSON is now rejected instead of being silently "repaired" into wrong arguments.
- Fixed strict providers (seen on Vercel with kimi-k3) rejecting a turn with "user message must have content" when a message held only empty text.
- Fixed a mid-turn crash on streamed tool calls with non-zero indexes, hit through LiteLLM's Anthropic passthrough.
- Compaction now respects your Max Output Tokens setting instead of a hardcoded 1024-token cap — reasoning models were spending the entire budget thinking, so no summary arrived and compaction was skipped every time.
- Vertex AI: added Fable 5 and custom model IDs, and the global-region picker no longer hides models from the live catalog.

## 0.0.11

- Images can now be pasted straight from the clipboard into the composer.
- Opening a folder that isn't a git repo no longer shows git jargon, and the welcome suggestions now adapt to what's actually in the folder instead of assuming a code project.
- The folder picker now reports failures instead of doing nothing, and offers a manual path entry as a fallback.
- Opening an existing session no longer overwrites the model you had selected.
- The diff panel now resolves file paths against the session's working directory, so diffs open correctly for sessions rooted outside the app's own directory.
- `/team` prompts now run through the core runtime.
- Failed turns surface their error in the transcript instead of leaving the chat blank.
- Plugins left behind as empty install directories are no longer listed as installed, and plugin settings and contributions are now managed centrally with atomic toggles.
- Fixed a startup script-load error, and webview errors are now attributed to the source URL that caused them.
- Signing out is handled as a normal state rather than surfacing as a command error.
- Native-feel and performance polish: the browser context menu is suppressed on app chrome (kept for text fields and selections), UI chrome is no longer text-selectable while chat content still is, inner scrollers no longer rubber-band the window, Settings/Sessions/Onboarding/Diff load lazily, the composer no longer flickers the caret on every keystroke, slash commands are cached across menu opens, and Escape closes the provider/model picker.
- Tool output no longer nests its own scrollbar.
- Prompts queued during a turn now survive being interrupted — they're preserved across aborts, drained after a turn aborts itself, and the stop is surfaced instead of the queue being silently dropped. Queued turns that fail are reported as failures.
- Session context stays durable across aborts and hub restarts.
- A hung MCP server no longer takes down session creation, and stdio servers that were never configured get a 30-second initialize budget instead of blocking indefinitely.
- Remote SSE MCP servers surface an OAuth authorization prompt on a 401 instead of failing outright.
- LiteLLM requests route through Chat Completions instead of the Responses API.
- Network interruptions mid-stream but before any model output are retried instead of failing the turn.
- Checkpoints are picked up when git is initialized part-way through a session, and checkpoint diffs include files that were untracked when the snapshot was taken.
- Scheduled run reports carry execution context — schedule metadata, durations, and lifecycle error details.

## 0.0.10

- Remote MCP servers can now authenticate with OAuth from Settings → MCP — authorize a server, see its auth status, and cancel or retry a pending authorization. Servers that require a pre-registered OAuth client (client ID/secret) instead of dynamic registration are now supported, and stored tokens are invalidated when a server's client configuration changes.
- MCP errors are now shown on the individual server rather than as a page-level error, and a server with invalid configuration is surfaced with its error instead of silently disappearing from the list.
- Failed turns no longer fail silently. Sending a message with no model credentials — or any queued turn that fails — now shows an error in the transcript, enriched with the underlying cause and a pointer to Settings → Models.
- Fixed the first message of a chat (and some queued messages) rendering twice.
- Fixed the composer getting stuck on "Agent is working…" after a turn already finished.
- New "Connect a model" notice on the welcome screen when no provider has credentials, with one click to onboarding or model settings. It reacts live as you add credentials, and correctly recognizes Bedrock/Vertex and keyless local endpoints as already connected.
- Added "Get an API key" links for popular providers in onboarding and Settings → Models, plus a link to the Cline dashboard from the Cline API key form.
- The onboarding welcome step now explains what Cline is.
- The stop button is now actually visible and clickable, Esc stops the current turn, and new shortcuts: Cmd/Ctrl+N for a new session, Cmd/Ctrl+, for settings.
- Reasoning controls now resolve consistently across AI SDK providers, including Ollama, so effort levels and thinking on/off are honored wherever the provider supports them.
- Vertex AI: credential refreshes now use the configured fetch, fixing ADC authentication behind proxies and custom networking.
- Refreshed the bundled provider and model catalog.

## 0.0.9

- Cline Code now ships as a single universal macOS download that runs natively on both Apple Silicon and Intel — no more picking the right architecture. Existing per-architecture installs migrate to it automatically on their next update.
- Session history can now be filtered by where a session came from — Desktop, CLI, extension, or scheduled — from a new filter control in the sidebar.
- The composer now shows a token usage ring for the active model's context window, with cumulative cost, and it changes color as you approach the limit.
- Skills now appear in the slash command menu alongside workflows, and commands that share a name are disambiguated instead of shadowing each other.
- Installed plugins now show their real package names instead of all appearing as "index".
- The agent header can be dragged to move the window again, including on read-only titles.
- Chat message actions (copy, fork, edit, restore) no longer collide with the descenders of the message's last line.
- Application errors are now reported in diagnostics, and the packaged app's telemetry configuration is baked into the sidecar at build time — previously the packaged build shipped with it empty, so no diagnostics were ever sent.
- Plan mode now hard-blocks file-editing shell commands rather than relying on prompting alone; read-only investigation still works.
- Running out of context is now recovered from automatically — the run compacts and retries once instead of failing with a raw provider error.
- Empty model responses are now retried on every provider, not just Ollama, fixing hard "Model returned empty response" failures on OpenRouter, Cline, and OpenAI-compatible endpoints.
- Claude 4.6+ and 5.x models are no longer rejected with "thinking.type.enabled is not supported".
- Bedrock prompt caching works again — cache reads and writes were always 0 — and Bedrock foundation models now route through geo inference profiles.
- Reasoning models on OpenAI-compatible endpoints now get the correct token parameter, and models without image support substitute image content instead of failing.
- Refreshed the bundled provider and model catalog, adding Infomaniak and SCX.ai.
- Upgraded the model layer to AI SDK 7 and switched Ollama to the native provider.

## 0.0.8

- Edit any earlier message in a conversation — the app forks the session at that point, rewinds the workspace to that run's checkpoint, and re-runs from your edited prompt. Restores are transactional and workspace-atomic, so a failed restore won't leave you half-rewound.
- Fixed long-running chat turns timing out mid-response.
- Checkpoints are now created reliably — including after a restart, after compaction, and on the first turn of a resumed session — and restoring one rewinds the whole workspace, not just the conversation.
- Fixed checkpoint restores failing after you closed and reopened a session.
- Reasoning controls (effort, thinking budget, on/off) now come from the shared model catalog, so each model gets exactly the reasoning options it actually supports instead of provider-specific guesses.
- Errors from upstream providers forwarded through the gateway now show the real message (e.g. "This model's maximum context length is 40960 tokens…") instead of a raw validation dump or `[object Object]`.
- Ollama: empty responses are retried automatically, and the response-start timeout is raised to 5 minutes so cold model loads don't error out.
- OpenRouter now defaults to Anthropic Claude Sonnet 5.
- Model pickers show proper display names for Cline free models and recommended models.
- MCP servers now honor their configured per-server timeout.
- Fixed API keys for several providers being lost when migrating from an older install — all secret-backed providers now migrate correctly.
- Unknown or removed legacy model IDs now fall back to the default Cline model instead of failing.
- Fixed agentic compaction not persisting reliably, so long conversations resume in the right state.
- Fixed a `.clinerules` single file (the older format) aborting the whole rules and config scan.
- Fixed video input being dropped for models that support it.
- Fixed the workspace hint being sent for filesystem-root paths.
- Custom model info for OpenAI-Compatible providers now carries over into the seeded model catalog.
- Removed the "Enable R1 messages format" option from the OpenAI-Compatible provider.

## 0.0.7

- New system tray icon showing app status and how many agent sessions are currently running.
- Session history is now paginated in ten-session pages, fetching older history only when you reach the end.
- You can favorite sessions, and sessions are now ordered by most recent activity with consistent status dot colors across views.
- Subagent and teammate runs from a session now show up in the app with their status and results.
- Chat polish: tool-specific icons on tool disclosures, elapsed thinking time and restyled reasoning sections, aligned timestamps, and message actions that no longer shift the layout while scrolling stays anchored to the conversation viewport.
- Free Cline models are now supported and labeled "(free)" in model pickers, with a clear message — including reset time — when you hit the free-tier limit.
- Fixed the China/international endpoint toggles for Qwen, Moonshot, Z AI, and MiniMax being ignored, which silently routed regional users to the wrong host.
- Fixed tool calls failing when a model emitted a line number as a string (e.g. `insert_line: "3"`), forcing the agent to waste a round trip retrying.
- Refreshed the bundled provider and model catalog.

## 0.0.6

- Queued messages now appear in a collapsible list above the composer with a count — expand it to edit, send-now, or delete individual queued turns.
- New sidebar update indicator: once an update has been downloaded, an accent-colored icon stays in the sidebar showing the new version with a one-click restart, so the update is still reachable after you dismiss the toast (and restart failures are now surfaced instead of silently doing nothing).
- No more appearance flash on launch — the app paints in your saved (or system) light/dark theme before the first frame.
- The header and sidebar now show the full workspace name and git branch, and lay out correctly on narrow windows; a transient git lookup no longer wipes a valid branch name back to "no git".
- Cleaner collapsed-sidebar settings layout: compact width, left-aligned navigation, stacked account details.
- Clarified the auto-update setting — it's now "Keep CLI up to date" and explains that it governs the `cline` terminal command, not the app itself (the app updates separately).
- Toggle switches now use a solid accent color when on, for clearer contrast.

## 0.0.5

- Major performance overhaul: the app now feels snappy end-to-end. The animated background renders at a locked 60fps instead of ~10fps, typing in the composer no longer stutters (245 slow keystrokes → 3), streaming responses coalesce updates instead of re-rendering the whole chat per token, and app boot fetches the provider catalog once instead of three times.
- The native folder picker and command execution no longer freeze the app while the sidecar writes session logs or discovers your editor.
- Fixed the composer getting stuck on "Agent is working..." after queued turns finished.
- Added a Cline API key path to onboarding, and you can now cancel a pending browser sign-in instead of being stuck waiting for it.
- Fixed window dragging.
- MCP server cards are now consistent across marketplace views, with a single uninstall action and setup guidance shown on installed servers.
- Fixed agentic compaction silently falling back to basic compaction for OpenAI-Compatible providers, and manual /compact never actually reaching the model when auto-compaction was off.

## 0.0.4

- Start chatting without opening a project folder — the app now supports workspace-free chat sessions.
- New first-run onboarding flow to get you set up on launch.
- Drag and drop files directly onto the chat to attach them.
- Image attachments now display inline in the chat transcript.
- Schedule one-time routines (not just recurring ones), with navigation to jump to a routine's run.
- New custom overlay title bar with in-app navigation.
- Redesigned channel setup as expandable cards.
- Added a setting to replay the new-user experience.
- Cleaner chat markdown rendering, and external links now open correctly in your browser.
- Agent sessions now use agentic compaction by default, keeping long conversations within context more intelligently.
- Fixed the agent not finding `gh` and other CLI tools by resolving your login shell's PATH.
- Headless routines now default to YOLO mode so they can run unattended.
- Fixed request metering for the SAP AI Core provider.

## 0.0.3

- The reasoning section in the chat transcript now reads simply "Thinking" — dropped the redundant status text and brain icon.

## 0.0.2

- First public release of Cline Code for macOS: a desktop app for running and inspecting Cline agent sessions, signed and notarized for Apple Silicon and Intel.
- Automatic updates: the app checks on launch and every 2 hours, downloads new versions in the background, and prompts for a one-click restart. Ignored updates apply on the next launch.
- Download the DMG once from GitHub Releases — every future release arrives automatically.
