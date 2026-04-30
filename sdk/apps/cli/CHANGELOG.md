# Cline CLI Changelog

## 0.0.7 (2026-04-30)

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

## 0.0.6 (2026-04-29)

- Add checkpoint restore: press Esc twice or type `/undo` to rewind to a previous checkpoint, with options to restore chat only or chat + workspace
- Fix clipboard: fall back to system clipboard (pbcopy, PowerShell, wl-copy, xclip) when OSC 52 fails, fixing copy for longer text selections
- Fix prompt focus: restore focus to the prompt input after dialogs close, preventing the input from becoming unresponsive after using `/settings`

## 0.0.5 (2026-04-28)

- The input field has been completely redesigned -- the old bordered box is replaced with a clean chevron-prompt style that adapts its background color to any terminal theme using perceptual OKLAB color math. Light terminals are fully supported now.
- Pasting 5+ lines into the input shows a compact preview marker instead of flooding the textarea. The full content is still submitted.
- Arrow-key history navigation respects cursor position so you don't lose your place when scrolling through previous prompts.
- The TUI renders immediately instead of blocking while the hub daemon boots. Hub readiness and session hydration happen in the background.
- Listing previous sessions no longer hydrates every full session, making `clite history` and the history picker snappy even with hundreds of sessions.
- Updating the CLI no longer leaves you connected to a stale hub daemon. Incompatible versions are detected and replaced automatically, eliminating the "Unsupported hub schedule command" class of errors.
- Schedules can now trigger on external events (webhooks, GitHub events, plugin-emitted signals) in addition to cron intervals, with deduplication, filtering, and retry policies.
- Plugins can register automation event types that feed into the scheduling system, enabling custom triggers from any source.
- Resuming a session automatically picks up any in-flight team runs without needing to remember or pass `--team-name`.
- `providers.json` (which stores API keys and OAuth tokens) is now written with 0600 permissions, preventing other processes on the machine from reading it.
- Models that emit `command` or `cmd` instead of `commands` (or `paths` instead of `path`) no longer fail. Common aliases are normalized before execution.

## 0.0.4 (2026-04-28)

- Fix compiled binary spawning infinite hub daemon recursion loop

## 0.0.3 (2026-04-28)

- Rewritten TUI from Ink to OpenTUI with streaming markdown, syntax-highlighted diffs, scrollable chat, and mouse support
- Dialog system for model picker, tool approval, settings browser, session history, and onboarding
- Interactive setup wizards: `clite connect`, `clite schedule`, `clite mcp`
- Plan/Act mode toggle with system prompt and tool rebuilding on switch
- Input autocomplete for slash commands and file mentions
- Message queuing and steer messages during running turns
- Platform-specific compiled binaries for macOS, Linux, and Windows (arm64 and x64)
- npm trusted publishing via GitHub Actions OIDC
