---
description: AI-Hydro built-in MCP tools — 28 hydrology tools for analysis, modelling, sessions, projects, and literature, all returning provenance-tracked HydroResult objects.
---

# Tool Reference

All tools are exposed via the [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) and can be called by any compatible AI agent. The agent decides which tools to call — you describe what you want to understand, and the agent orchestrates the right sequence.

---

## Tool Categories

| Category | Tools | Description |
|----------|-------|-------------|
| [Analysis Tools](analysis.md) | 9 tools | Data retrieval, watershed, signatures, terrain, library reference |
| [Modelling Tools](modelling.md) | 2 tools | HBV-light, LSTM calibration and results |
| [Project & Literature](project.md) | 10 tools | Projects, literature indexing, researcher persona |
| [Session Tools](session.md) | 7 tools | Session management, export, tool discovery, provenance |

**Total: 28 built-in tools.** Community plugins add more — call `list_available_tools()` at runtime for the live count on your installation.

---

## Data Contract

All tools return a `HydroResult` object:

```python
@dataclass
class HydroResult:
    data: dict          # tool-specific results
    meta: HydroMeta     # provenance metadata

@dataclass
class HydroMeta:
    tool: str           # tool name
    version: str        # aihydro-tools version
    source: str         # data source (e.g., "USGS NWIS")
    retrieved_at: str   # ISO 8601 timestamp
    parameters: dict    # input parameters used
```

This contract is what makes provenance automatic — every result carries the information needed to reproduce the computation.

---

## Community Tools

Tools registered via the `aihydro.tools` entry-point system appear here automatically after the server restarts. Call `list_available_tools()` at any time to see what is currently registered on your installation.

See [Plugin Overview](../plugins/overview.md) for how to contribute tools or library reference cards.
