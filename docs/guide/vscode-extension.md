# VS Code Extension

The AI-Hydro VS Code extension is the primary interface for interacting with the platform. It embeds a full AI agent with direct access to the MCP tool server.

---

## Interface Overview

The extension adds a sidebar panel to VS Code with:

- **Chat interface** — where you talk to the agent
- **Tool call log** — shows each MCP tool call as it happens, with parameters and results
- **File diff viewer** — when the agent writes or modifies files
- **Terminal integration** — for standalone Python scripts the agent writes and executes

---

## Auto-Registration

On first activation, the extension automatically:

1. Detects `aihydro-mcp` on your PATH (or `python -m ai_hydro.mcp` as fallback)
2. Writes the server entry to `aihydro_mcp_settings.json`
3. Starts the MCP server process

No manual JSON editing required.

**Settings file location:**
```
~/Library/Application Support/Code/User/globalStorage/aihydro.ai-hydro/settings/
└── aihydro_mcp_settings.json
```

---

## Supported AI Providers

Configure your provider and API key in the extension settings panel:

| Provider | Models | Notes |
|----------|--------|-------|
| Anthropic | Claude Sonnet 4.6, Opus 4.6 | Recommended starting point |
| OpenAI | GPT-5.4, GPT-5.4 mini, o3-pro | |
| Google Gemini | Gemini 3.1 Pro, 2.5 Flash | |
| AWS Bedrock | Claude on Bedrock | Enterprise / VPC deployments |
| Azure OpenAI | GPT models via Azure | |
| Ollama / LM Studio | Local models | No API key needed |
| OpenRouter | Any supported model | Single API key for all providers |

!!! tip "Recommended model"
    **Claude Sonnet 4.6** offers the best balance of speed, reasoning quality, and cost for hydrological research workflows. Use **Opus 4.6** for complex multi-step analyses.

---

## Context Rules

AI-Hydro uses `.aihydrorules` files to inject persistent context into every conversation. These are placed in your workspace root or home directory.

The most important auto-generated file is `.aihydrorules/research.md` — written by `sync_research_context` — which injects your current session state, project context, and researcher profile into every conversation automatically.

```markdown title=".aihydrorules/research.md (auto-generated)"
# AI-Hydro Research Context

## Active Sessions
- Gauge 01031500: watershed ✓, streamflow ✓, signatures ✓, model ✓

## Active Project
- New England Basins (4 gauges)

## Researcher Profile
- Mohammad Galib — Computational Hydrology, Purdue
- Focus: baseflow generation in fractured rock basins
```

---

## Keyboard Shortcuts

| Action | Mac | Windows/Linux |
|--------|-----|---------------|
| Open AI-Hydro panel | `Cmd+Shift+A` | `Ctrl+Shift+A` |
| New conversation | `Cmd+L` | `Ctrl+L` |
| Cancel running task | `Escape` | `Escape` |

---

## Ignoring Files

Create a `.aihydroignore` file in your workspace to prevent the agent from reading sensitive files:

```gitignore title=".aihydroignore"
.env
credentials/
private_data/
*.key
```

---

## MCP Server Status

If the server is not responding, check:

```bash
# Test server health
aihydro-mcp --diagnose

# Restart manually
pkill -f "aihydro-mcp"
aihydro-mcp
```

Or reload the VS Code window: `Cmd+Shift+P` → **Developer: Reload Window**.
