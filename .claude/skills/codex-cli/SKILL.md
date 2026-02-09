---
name: codex-cli
description: Invoke OpenAI Codex CLI for rapid iterative coding, code review, and Git-aware refactoring. Use when the user needs fast code edits, wants Codex to review changes before commit, needs non-interactive scripted execution, or wants to leverage OpenAI's o3/o4-mini/codex-1 reasoning models for code tasks. Triggers include "quick fix", "review my changes", "codex refactor", "fast edit", or requests for code review, rapid prototyping, and Git-aware modifications.
---

# Codex CLI Integration

Codex CLI is OpenAI's open-source coding agent built in Rust, providing fast local code execution with reasoning models (gpt-5-codex, o3, o4-mini, codex-1).

## Prerequisites

Verify installation: `codex --version`

If not installed:
```bash
npm i -g @openai/codex
# or
brew install --cask codex
```

Authentication:
- OAuth (recommended): Run `codex` and select "Sign in with ChatGPT"
- API key: `export OPENAI_API_KEY="YOUR_KEY"`

## Core Commands

### Interactive Mode
```bash
codex                               # Start full-screen TUI session
codex "Fix the bug in main.py"      # Single prompt with interactive session
```

### Non-Interactive Mode (Scripting)
```bash
codex exec "Add type hints to utils.py"              # Execute and exit
codex e "Refactor for DRY"                           # Short form
codex exec "Run tests" --output-format jsonl         # Structured output for CI
codex exec "Run linter" --full-auto                  # No approval prompts
```

### Cloud Integration
```bash
codex cloud                         # Interactive picker for cloud tasks
codex cloud list                    # Browse active/finished tasks
codex cloud apply <task-id>         # Apply cloud changes to local project
```

## Approval Modes

| Mode | Flag | Behaviour |
|------|------|-----------|
| Auto (default) | none | Read files, edit, run commands in working directory. Asks for network/external access |
| Auto-edit | `--auto-edit` | Auto-approve file edits, prompt for commands |
| Read-only | `--read-only` | Consultative mode - browses but doesn't change until you approve |
| Full Access | `--full-auto` | Full autonomy including network. Use only in trusted environments |

```bash
codex                               # Default approval mode
codex --auto-edit "Fix imports"     # Auto-approve edits only
codex --full-auto "Run full test suite"  # Complete autonomy
```

## When to Use Codex CLI

| Scenario | Command Pattern |
|----------|-----------------|
| Quick code fix | `codex exec "Fix the syntax error in app.py"` |
| Pre-commit review | `codex exec "Review staged changes for issues"` |
| Refactoring | `codex "Refactor this module for better testability"` |
| Test generation | `codex exec "Write tests for @src/auth.py"` |
| Git-aware edits | `codex "Update based on recent commits"` |
| CI integration | `codex exec "Lint and fix" --output-format jsonl` |
| Cloud task triage | `codex cloud` |

## File References

Reference files with `@` syntax:
```bash
codex "Explain @src/api/routes.py"
codex @package.json "Update dependencies"
codex "Compare @old.py and @new.py"
```

## Session Management

```bash
codex resume                        # Resume most recent session
codex resume <session-id>           # Resume specific session
```

## Slash Commands (Interactive)

| Command | Description |
|---------|-------------|
| `/model` | Switch model (gpt-5-codex, codex-1, o3, o4-mini) |
| `/approvals` | Change approval mode mid-session |
| `/diff` | Inspect Git diff (staged, unstaged, untracked) |
| `/review` | Summarise issues in working tree, focus on behaviour changes and missing tests |
| `/compact` | Replace earlier turns with concise summary, freeing context |
| `/new` | Start fresh conversation in same CLI session |
| `/fork` | Branch conversation |
| `/init` | Generate AGENTS.md for project |
| `/elevate-sandbox` | Upgrade to elevated sandbox mode |

## Model Selection

Codex defaults to `gpt-5-codex` on macOS/Linux and `gpt-5` on Windows. Switch models:
```bash
codex --model o3 "Complex reasoning task"
# or use /model slash command in interactive mode
```

Available models:
- `gpt-5-codex` - Default, optimised for coding
- `gpt-5.2-codex` - Latest frontier model with improved reasoning
- `codex-1` - Specialised coding model
- `o3` - Advanced reasoning
- `o4-mini` - Fast reasoning

## Integration Pattern

When delegating to Codex CLI:
1. Assess if task benefits from fast iteration or Git context
2. Choose approval mode based on trust level and task scope
3. Use `codex exec` with `--output-format jsonl` for scripted workflows
4. For complex tasks, use interactive mode to review steps
5. Use `/review` before commits to catch issues

## Configuration

Config stored in `~/.codex/config.toml`:
```toml
[defaults]
model = "gpt-5-codex"
approval_mode = "auto"
```

## Notes

- AGENTS.md files provide persistent project instructions (similar to CLAUDE.md)
- Codex creates checkpoints before file modifications
- Included with ChatGPT Plus/Pro/Business/Enterprise subscriptions
- Codex app (macOS) available for long-running multi-hour/week projects

## Sources

- [Codex CLI Documentation](https://developers.openai.com/codex/cli/)
- [Codex CLI Features](https://developers.openai.com/codex/cli/features/)
- [Command Line Reference](https://developers.openai.com/codex/cli/reference/)
- [Slash Commands](https://developers.openai.com/codex/cli/slash-commands/)
- [GitHub Repository](https://github.com/openai/codex)
