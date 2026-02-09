---
name: gemini-cli
description: Invoke Google Gemini CLI for tasks requiring massive context windows (1M+ tokens), multi-modal analysis, or Google Search grounding. Use when analysing entire codebases, processing large log files, examining multiple documents simultaneously, or when web search context would enhance the response. Triggers include phrases like "analyse this whole project", "search the web for", "process these logs", "review the entire codebase", or when working with content exceeding typical context limits.
---

# Gemini CLI Integration

Gemini CLI is Google's open-source AI agent providing access to Gemini 3 models (1M token context) directly from the terminal. It uses a reason and act (ReAct) loop with built-in tools and MCP server support.

## Prerequisites

Verify installation: `gemini --version`

If not installed:
```bash
npm i -g @google/gemini-cli
```

Authentication (one of):
- OAuth: Run `gemini` and follow prompts
- API key: `export GEMINI_API_KEY="YOUR_KEY"`

## Free Tier Limits

- 60 requests/minute
- 1,000 requests/day
- Personal Google account required

## Core Commands

### Interactive Mode
```bash
gemini                              # Start interactive session
gemini "Explain this codebase"      # Single prompt, interactive
```

### Non-Interactive Mode (Scripting)
```bash
gemini -p "Summarise README.md"                       # Single prompt, exit after response
gemini -p "List all TODO comments" --output-format json  # JSON output for parsing
```

### File and Directory Context
```bash
gemini @src/                        # Include directory in context
gemini @package.json @tsconfig.json "Explain the build setup"
gemini "Analyse @./logs/*.log for errors"
```

## When to Use Gemini CLI

| Scenario | Command Pattern |
|----------|-----------------|
| Codebase analysis (large) | `gemini "Explain the architecture of @./src/"` |
| Multi-file review | `gemini @file1.py @file2.py "Compare these implementations"` |
| Web-grounded queries | `gemini "What are the latest best practices for X?"` |
| Log analysis | `gemini -p "Find errors in @./logs/" --output-format json` |
| Documentation generation | `gemini "Generate API docs for @./src/api/"` |
| Large context tasks | Tasks exceeding typical 100-200k token limits |

## File References with @

The `@` syntax includes file/directory content in your prompt:
```bash
gemini @src/                        # Include entire directory
gemini @package.json                # Include single file
gemini @./logs/*.log                # Glob pattern
gemini @file1.py @file2.py          # Multiple files
```

Context respects `.gitignore` and `.geminiignore` files.

## Capturing Output

For programmatic use:
```bash
# Capture JSON response
result=$(gemini -p "List functions in @main.py" --output-format json)

# Pipe to file
gemini -p "Summarise @./docs/" > summary.md
```

## Slash Commands (Interactive)

### Help & Navigation
| Command | Description |
|---------|-------------|
| `/help` | Display help information |
| `/quit` | Exit Gemini CLI |
| `/docs` | Open documentation in browser |

### Model & Settings
| Command | Description |
|---------|-------------|
| `/model` | Choose model (Gemini 3 Pro or Flash) |
| `/settings` | Interactive settings editor (validates changes) |

### Memory & Context
| Command | Description |
|---------|-------------|
| `/memory` | Manage AI's instructional context |
| `/memory add <text>` | Add text to memory |
| `/memory show` | Display combined instructional context |
| `/memory refresh` | Re-scan and reload all context files |

### MCP Servers
| Command | Description |
|---------|-------------|
| `/mcp` | List configured MCP servers and tools |
| `/mcp verbose` | Show detailed tool descriptions |
| `/mcp quiet` | Show only tool names |

### Checkpointing & History
| Command | Description |
|---------|-------------|
| `/restore` | Restore files to state before a tool execution |
| `/rewind` | Browse and rewind previous interactions |
| `/resume` | Browse and resume previous sessions |
| `/chat save <tag>` | Save conversation with tag |

### Extensions & Skills
| Command | Description |
|---------|-------------|
| `/extensions` | List active extensions |
| `/skills` | Manage Agent Skills (experimental) |
| `/skills list` | List available skills |
| `/skills enable` | Enable a skill |
| `/skills disable` | Disable a skill |

### Hooks & IDE
| Command | Description |
|---------|-------------|
| `/hooks` | Manage lifecycle hooks |
| `/ide` | Manage IDE integration (enable/disable/install) |

### Workspace & Files
| Command | Description |
|---------|-------------|
| `/directory` | Manage workspace directories |
| `/directory add` | Add directory to workspace |
| `/directory list` | List workspace directories |
| `/init` | Generate tailored GEMINI.md context file |

### Utilities
| Command | Description |
|---------|-------------|
| `/copy` | Copy last output to clipboard |
| `/stats` | Token usage statistics |

## Built-in Tools

| Tool | Description |
|------|-------------|
| `read_file` | Read single file |
| `write_file` | Write to file |
| `read_many_files` | Read multiple files at once |
| `run_shell_command` | Execute shell commands |
| `web_fetch` | Fetch content from URLs |
| `google_web_search` | Search the web with Google |
| `save_memory` | Persist information to memory |

## Model Selection

Available models via `/model`:
- **Gemini 3 Pro** - Full capabilities, improved reasoning
- **Gemini 3 Flash** - Faster responses

## Context Files

GEMINI.md files provide persistent context (similar to CLAUDE.md):
- Project-level: `./GEMINI.md`
- User-level: `~/.gemini/GEMINI.md`

Generate with `/init` command.

## Integration Pattern

When delegating to Gemini CLI:
1. Determine if task benefits from large context (1M tokens) or web search
2. Construct command with appropriate file references using `@` syntax
3. Use `-p` and `--output-format json` for structured output to parse
4. Present results to user, noting any architectural insights
5. Use `/stats` to monitor token usage

## Configuration

Settings stored in `.gemini/settings.json`. Edit via `/settings` command for validation and guidance.

## Notes

- Context respects `.gitignore` and `.geminiignore`
- Clipboard operations require platform-specific tools
- MCP (Model Context Protocol) support for custom integrations
- Uses ReAct (reason and act) loop for complex tasks

## Sources

- [Gemini CLI Documentation](https://geminicli.com/docs/)
- [CLI Commands Reference](https://geminicli.com/docs/cli/commands/)
- [GitHub Repository](https://github.com/google-gemini/gemini-cli)
- [Google for Developers](https://developers.google.com/gemini-code-assist/docs/gemini-cli)
- [Google Cloud Documentation](https://docs.cloud.google.com/gemini/docs/codeassist/gemini-cli)
- [Hands-on Codelab](https://codelabs.developers.google.com/gemini-cli-hands-on)
