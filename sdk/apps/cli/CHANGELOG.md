# Cline CLI Changelog

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
