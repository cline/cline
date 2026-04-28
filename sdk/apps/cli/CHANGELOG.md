# Cline CLI Changelog

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
