# Cline Code Desktop Changelog

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
