---
description: Extend AI-Hydro with community hydrology tools. Two plugin paths: Python entry-point plugins and standalone MCP servers. Flood frequency, sediment transport, groundwater, and more.
---

# Plugin Overview

AI-Hydro is a platform, not a closed product. The most impactful contributions are new domain tools — knowledge that currently lives in papers and custom scripts, packaged so any AI agent can discover and use it.

---

## Three Plugin Paths

| | Path A: Standalone MCP Server | Path B: Entry-Point Plugin | Path C: Knowledge Plugin |
|--|-------------------------------|---------------------------|--------------------------|
| **Best for** | Full sub-domain toolkits, complex dependencies | Single tools, small extensions | Library API references, field-name gotchas |
| **Runs as** | Separate process | Loaded into `aihydro-mcp` process | Loaded into `aihydro-mcp` process |
| **What it adds** | New MCP tools | New MCP tools | Library reference cards for `get_library_reference` |
| **Dependency isolation** | Complete | Shares `aihydro-tools` environment | Shares `aihydro-tools` environment |
| **HydroSession access** | Via MCP tool calls | Direct Python access | N/A |
| **Distribution** | Any MCP-compatible client | `pip install` auto-discovers | `pip install` auto-discovers |
| **Examples** | HEC-RAS interface, SWMM wrapper | Flood frequency tool, snow signature | VIC model API card, TOPMODEL reference |

---

## High-Priority Contribution Areas

The following domains have the highest demand from the community and no current built-in tools:

- **Flood frequency analysis** — L-moments, GEV fitting, return period estimation
- **Sediment transport** — rating curves, suspended load, reservoir sedimentation
- **Groundwater** — well analysis, aquifer characterisation, recharge estimation
- **Remote sensing** — MODIS snow cover, Landsat ET, SAR soil moisture
- **Water quality** — nutrient loading, temperature modelling, DO
- **Snow hydrology** — SWE retrieval, melt modelling, snowpack depletion curves
- **Irrigation & water resources** — consumptive use, irrigation scheduling, reservoir operations
- **Hydraulic modelling** — 1D/2D flood mapping, HEC-RAS integration

---

## Getting Started

→ [Path B: Entry-Point Plugin](entry-point.md) — fastest to implement, recommended for single tools
→ [Path A: Standalone MCP Server](standalone-server.md) — for full toolkits with heavy dependencies
→ [Data Contract](data-contract.md) — `HydroResult` / `HydroMeta` spec all tools must follow

---

## Plugin Discovery

### Tool plugins (`aihydro.tools`)

Entry-point tool plugins are discovered automatically when the `aihydro-mcp` server starts:

```python
# ai_hydro/mcp/registry.py
from importlib.metadata import entry_points

def discover_tools():
    for ep in entry_points(group="aihydro.tools"):
        tool_fn = ep.load()
        mcp.tool()(tool_fn)  # registers with FastMCP
```

Install a community package → restart the server → the tool appears in `list_available_tools()`. No changes to the core required.

### Knowledge plugins (`aihydro.knowledge`)

Knowledge plugins contribute **library reference cards** — structured JSON files covering field-name gotchas, API quirks, unit conventions, and copy-paste patterns for a specific library. These feed the `get_library_reference` tool.

```python
# ai_hydro/mcp/registry.py
def discover_knowledge():
    for ep in entry_points(group="aihydro.knowledge"):
        get_dir = ep.load()
        ref_dir = get_dir()   # returns pathlib.Path to *.json files
```

A knowledge plugin exports one function that returns a `Path` to a directory of JSON reference files:

```python title="my_package/knowledge.py"
from pathlib import Path

def get_refs_dir() -> Path:
    return Path(__file__).parent / "library_refs"
```

Register it in `pyproject.toml`:

```toml title="pyproject.toml"
[project.entry-points."aihydro.knowledge"]
my_lib = "my_package.knowledge:get_refs_dir"
```

Each JSON file in `library_refs/` follows the schema used by the built-in cards:

```json title="library_refs/vic_model.json"
{
  "library": "vic_model",
  "version_tested": "5.x",
  "purpose": "Variable Infiltration Capacity macroscale hydrological model",
  "field_mappings": {
    "run_vic": {
      "forcing_param": "path to meteorological forcing files (NetCDF)",
      "note": "Forcing files must have vars: prec, tmax, tmin, wind"
    }
  },
  "gotchas": [
    "VIC outputs are in local time — convert to UTC before merging with NWIS data.",
    "State files are binary — do not try to read them as text."
  ],
  "common_patterns": {
    "run_with_forcings": "from vic import VIC\nmodel = VIC(params_file='params.nc')\nmodel.run(forcings_dir='./forcings/', start='2000-01-01', end='2020-12-31')"
  }
}
```

Install the plugin → restart the server → `get_library_reference("vic_model")` returns the card. The agent can call this before writing any script that uses the library.
