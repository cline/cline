---
name: copilot-cli
description: Invoke GitHub Copilot CLI for GitHub-integrated tasks, shell command suggestions, issue/PR management, and repository context. Use when the user needs help with GitHub-specific operations, wants verified shell commands, needs to interact with issues or pull requests, or requires repository metadata. Triggers include "GitHub issue", "pull request", "suggest a command", "explain this command", "what's the gh command for", or requests involving GitHub workflow integration.
---

# GitHub Copilot CLI Integration

GitHub Copilot CLI is an AI-powered terminal agent with native GitHub integration, powered by Claude Sonnet 4.5 (default), GPT-5 mini, GPT-4.1, and other models. It uses the same agentic harness as GitHub's Copilot coding agent.

## Prerequisites

Verify installation: `copilot --version`

If not installed:
```bash
npm install -g @github/copilot
# or
curl -fsSL https://gh.io/copilot-install | bash
# or download standalone executables from GitHub releases
```

Also available in:
- Default GitHub Codespaces image
- Dev Container Feature

Authentication:
```bash
copilot        # First run triggers OAuth flow with GitHub credentials
# or with PAT
export GH_TOKEN="YOUR_TOKEN"  # Requires "Copilot Requests" permission
```

## Core Commands

### Interactive Mode
```bash
copilot                             # Start agent session
copilot "Fix the failing tests"     # Single prompt with session
```

### Legacy Suggest/Explain (via gh extension)
```bash
gh copilot suggest "Find large files in git history"
gh copilot suggest -t git "Squash last 3 commits"
gh copilot suggest -t gh "List my assigned issues"
gh copilot explain "git rebase -i HEAD~5"
```

### Quick Aliases
After running `gh copilot alias`, these shortcuts become available:
```bash
ghcs "Delete merged branches"       # Suggest shell command
ghce "tar -czvf archive.tar.gz"     # Explain command
```

### Utility Commands
```bash
copilot version                     # Check version
copilot update                      # Update to latest
```

## When to Use Copilot CLI

| Scenario | Command Pattern |
|----------|-----------------|
| Shell command help | `gh copilot suggest "Find files larger than 100MB"` |
| Git operations | `gh copilot suggest -t git "Undo last commit but keep changes"` |
| GitHub CLI help | `gh copilot suggest -t gh "Create PR from current branch"` |
| Command explanation | `gh copilot explain "awk '{print $2}' file.txt"` |
| Issue interaction | `copilot "List open issues assigned to me"` |
| PR context | `copilot "Summarise changes in PR #42"` |
| Codebase questions | Use Explore agent: fast analysis without cluttering main context |

## Interaction Modes

Cycle modes with Shift+Tab:
- **Default**: Approve each action individually
- **Autopilot**: Agent continues until task complete

## Permission Controls

```bash
copilot --allow-tool 'shell'        # Allow all shell commands
copilot --deny-tool 'shell(rm)'     # Block rm commands
copilot --allow-tool 'write'        # Allow file modifications
copilot --allow-all-tools           # Full access (same permissions as your user)
```

Tool filtering flags also apply to subagents.

## Custom Agents

Copilot CLI includes specialised agents:

| Agent | Purpose |
|-------|---------|
| **Explore** | Fast codebase analysis - ask questions without cluttering main context |
| **Task** | Runs commands like tests and builds |

Create custom agents through the interactive CLI wizard for specialised tasks following your team's guidelines.

## Slash Commands (Interactive)

| Command | Description |
|---------|-------------|
| `/model` | Switch model (Claude Sonnet 4.5, GPT-5 mini, GPT-4.1) |
| `/experimental` | Enable preview features |
| `/feedback` | Submit feedback |
| `/login` | Re-authenticate |
| `/cwd` | Change working directory (with tab completion) |
| `/add-dir` | Add directory to context (with tab completion) |
| `/skills add` | Add skills from directories containing SKILL.md |
| `/plugin install` | Install plugins from GitHub repos, URLs, or local paths |

## Model Selection

Default model is Claude Sonnet 4.5. GPT-5 mini and GPT-4.1 are included with your subscription and don't consume premium requests.

```bash
# Use /model slash command in interactive mode to switch
```

## Context & Tools

### Copilot Spaces
The GitHub MCP server includes Copilot Spaces tools for project-specific context.

### Web Fetch
The `web_fetch` tool retrieves content from URLs as markdown. Control access in `~/.copilot/config`:
```json
{
  "allowed_urls": ["github.com/*", "docs.example.com/*"],
  "denied_urls": ["*.internal.corp/*"]
}
```
These rules also apply to shell commands like curl and wget.

### Auto-Compaction
When approaching 95% of token limit, Copilot automatically compresses your history.

## Terminal Experience

- **Better diffs**: Intra-line syntax highlighting shows exactly what changed
- **Git pager integration**: Integrates with your configured Git pager
- **Tab completion**: Autocomplete paths in `/cwd` and `/add-dir`
- **Ctrl+T**: Toggle model reasoning visibility (supported models)

## Hooks

Execute custom shell commands at key lifecycle events:
- Validation
- Logging
- Security scanning
- Workflow automation

`preToolUse` hooks can deny tool execution and modify arguments.

## Skills

Enhance Copilot's ability to perform specialised tasks with:
- Instructions
- Scripts
- Resources

## LSP Support

Provides intelligent code features:
- Go-to-definition
- Hover information
- Diagnostics

Note: Copilot CLI doesn't bundle LSP servers - install them separately.

## Integration Pattern

When delegating to Copilot CLI:
1. For quick command suggestions, use `gh copilot suggest -t <target>`
2. For complex tasks or GitHub integration, use standalone `copilot`
3. Verify suggested commands before presenting to user
4. Note the target type (shell/git/gh) for appropriate suggestions
5. Use Explore agent for codebase questions to preserve main context

## Configuration

Config stored in `~/.copilot/config`:
```json
{
  "allowed_urls": [],
  "denied_urls": []
}
```

## Notes

- Directory trust required on first run in each workspace
- GitHub MCP server included for native GitHub.com interaction
- Legacy `gh copilot` extension deprecated October 2025
- Requires Copilot Pro/Pro+/Business/Enterprise subscription

## Sources

- [GitHub Copilot CLI Documentation](https://docs.github.com/en/copilot/concepts/agents/about-copilot-cli)
- [Using GitHub Copilot CLI](https://docs.github.com/en/copilot/how-tos/use-copilot-agents/use-copilot-cli)
- [GitHub Copilot CLI Features](https://github.com/features/copilot/cli)
- [GitHub Repository](https://github.com/github/copilot-cli)
- [Slash Commands Cheat Sheet](https://github.blog/ai-and-ml/github-copilot/a-cheat-sheet-to-slash-commands-in-github-copilot-cli/)
- [January 2026 Changelog](https://github.blog/changelog/2026-01-14-github-copilot-cli-enhanced-agents-context-management-and-new-ways-to-install/)
