---
description: The AI-Hydro VS Code extension — chat, Map, HTML Preview, Skills, Connectors panels; MCP auto-registration; keyboard shortcuts; and .aihydroignore configuration.
---

# VS Code Extension

The AI-Hydro VS Code extension is the primary interface for interacting with the platform. It embeds a full AI agent with direct access to the MCP tool server, and adds five specialised panels to VS Code's editor area.

---

## Sidebar Panels

The AI-Hydro icon in the VS Code activity bar opens the primary sidebar, where the main **Chat** panel lives. Additional panels open in the editor area:

| Panel | How to open | What it does |
|---|---|---|
| **Chat** | AI-Hydro icon in activity bar | Main conversation interface; tool call log; file diff viewer |
| **Map** | Map button in sidebar toolbar | Interactive geospatial layer viewer — auto-receives analysis outputs |
| **HTML Preview** | HTML Preview button in sidebar toolbar | Built-in Python kernel for interactive HTML artifacts and learning modules |
| **Skills** | Skills icon in sidebar toolbar | Browse installed skills and the marketplace; install workflow playbooks |
| **Connectors** | Connectors icon in sidebar toolbar | Authenticate external data sources (Google Earth Engine, and more) |

---

## Chat Panel

The chat panel is where you interact with the agent:

- **Message input** — describe your research task in plain language
- **Tool call log** — each MCP tool call appears inline as a collapsible card showing parameters, status, and results
- **File diff viewer** — when the agent writes or modifies files, a diff appears for review
- **Terminal integration** — standalone Python scripts the agent writes appear in an integrated terminal
- **Plan mode** — the agent proposes a plan before executing when the task involves multiple steps

---

## Map Panel

The Map panel renders geospatial analysis outputs as interactive layers inside VS Code. See the [Map Panel guide](map.md) for the full reference.

**Key capabilities:**
- Auto-receives layers from analysis tools (`delineate_watershed`, `compute_twi`, `create_cn_grid`)
- Drag-and-drop file loading — GeoJSON, KML, KMZ, GPX, Shapefile, GeoTIFF, CSV
- Per-layer symbology editor with colour picker, opacity, and colormap selection
- 13 free basemaps including USGS Topo, USGS Imagery, Esri Hillshade, and Carto variants
- Agent can style and update layers via `map_update_layer` and `map_apply_symbology` MCP tools

---

## HTML Preview Panel

The HTML Preview panel is a built-in execution environment for interactive HTML artifacts. See the [HTML Preview guide](html-preview.md) for the full reference.

**Key capabilities:**
- Runs Python cells inside HTML files via a built-in kernel — no Jupyter server needed
- Auto-opens AI-Hydro learning modules when the agent writes them
- Single-row toolbar: run cell, run all, restart & run all, stop, clear; animated kernel status chip
- Python environment selector with per-artifact kernel isolation
- Supports the `show_html_preview` MCP tool for agent-initiated opens

---

## Skills Panel

The Skills panel manages workflow playbooks for the agent. See the [Skills guide](skills.md) for the full reference.

**Key capabilities:**
- **Configured tab** — all installed skills (marketplace, agent-created, manual, workspace-local)
- **Marketplace tab** — browse and install skills from `github.com/AI-Hydro/Skills`
- Skills are loaded automatically by the agent before planning any covered task
- Agent-created skills (from `save_skill()`) appear here immediately

---

## Connectors Panel

The Connectors panel manages authenticated links to external data sources. See the [Connectors guide](connectors.md) for the full reference.

**Live connectors:**
- **Google Earth Engine** — OAuth-authenticated access to the GEE public catalog; three MCP tools (`gee.status`, `gee.preview_layer`, `gee.extract_timeseries`)

**Coming soon:** HAWQS, USGS NWIS, HydroShare, Planetary Computer, OpenTopography, NASA Earthdata

---

## Interface Overview (continued)

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

Configure your provider and API key in the extension settings panel. See the dedicated [Models & Providers](providers.md) page for the current recommended model and the full provider matrix.

At a glance, AI-Hydro supports every provider the underlying agent supports — Anthropic, OpenAI, Google Gemini, AWS Bedrock, Azure OpenAI, OpenRouter, Ollama, LM Studio, and others — including local models for fully offline use.

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
