---
"cline": minor
---

Comprehensive Bcline improvements: Voice, Messaging, CLI Integration, Bug Fixes

### Voice Input
- Web Speech API real-time streaming transcription
- Windows voice dictation fix with dynamic FFmpeg device detection
- Real-time interim text display, green pulsing indicator

### Messaging System
- BCline cross-directory bidirectional messaging
- Message Queue Service with help command
- Bidirectional completion callbacks for CLI routing

### CLI Integrations
- Claude CLI, Gemini CLI, Codex agent mode integration
- @claude, @codex, @cline chat participants in Copilot
- Model switching and auto-approve commands

### Bug Fixes (13 issues from cline/cline)
- [#8051](https://github.com/cline/cline/issues/8051): Add retry limit (3x) to prevent infinite loops on missing tool parameters
- [#8030](https://github.com/cline/cline/issues/8030): Fix LM Studio endpoint - try v1/models first, fallback to api/v0/models
- [#8058](https://github.com/cline/cline/issues/8058): Fix export task regression in SSH remote environments
- [#7974](https://github.com/cline/cline/issues/7974): Preserve Gemini 3 thought_signature for function calls
- [#7969](https://github.com/cline/cline/issues/7969): Require Ctrl+Enter to send prompt (Enter creates newline)
- [#7972](https://github.com/cline/cline/issues/7972): Use deterministic hash for MCP server keys (fixes tool routing after restart)
- [#7931](https://github.com/cline/cline/issues/7931): Handle object inputs in processToolUseDelta for Claude Code provider
- [#7960](https://github.com/cline/cline/issues/7960): Check MCP server capabilities before requesting resources
- [#7957](https://github.com/cline/cline/issues/7957): Fix Gemini thinking_budget/thinking_level mutual exclusivity
- [#8004](https://github.com/cline/cline/issues/8004): Add persistence error rate limiting (prevents error dialog spam)
- [#8365](https://github.com/cline/cline/issues/8365): Handle DeepSeek V3.2 XML tool calls in reasoning_content
- [#8182](https://github.com/cline/cline/issues/8182): Show zero cost for free models (`:free` suffix detection)
- [#8129](https://github.com/cline/cline/issues/8129): Safe parsing for decimal inputs (prevents NaN/crash on `.25` input)
- Null-safety fix for `providerInfo` in capabilities.ts

### Additional
- GPT-5 and Grok prompt cache support
- Agent orchestration (pipeline/parallel)
- VSIX size optimization (50MB → 9.5MB)
- Merged v3.47.0 with all upstream updates
