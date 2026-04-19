---
description: Build a standalone MCP server for AI-Hydro — full sub-domain toolkits with dependency isolation, registered alongside aihydro-mcp via the extension settings.
---

# Path A: Standalone MCP Server

Build an independent MCP server for a full sub-domain toolkit. Runs as a separate process with full dependency isolation — ideal for heavy dependencies (HEC-RAS, SWMM, R packages) or complete toolkits.

---

## When to use Path A

- Your toolkit has conflicting or heavy dependencies (GDAL versions, R, Fortran libraries)
- You're wrapping an existing model (HEC-RAS, SWMM, VIC, mHM)
- You want to publish a complete toolset under a different namespace
- You need multi-process parallelism or GPU isolation

---

## Structure

```
aihydro-floodfreq/
├── pyproject.toml
└── aihydro_floodfreq/
    ├── __init__.py
    ├── server.py        ← FastMCP app entry point
    └── tools.py         ← tool functions
```

### server.py

```python title="aihydro_floodfreq/server.py"
from fastmcp import FastMCP
from aihydro_floodfreq import tools

mcp = FastMCP(
    "aihydro-floodfreq",
    instructions="Flood frequency analysis tools: L-moments, GEV fitting, return period estimation."
)

mcp.tool()(tools.fit_flood_frequency)
mcp.tool()(tools.get_return_period)
mcp.tool()(tools.plot_flood_frequency_curve)


def main():
    mcp.run()


if __name__ == "__main__":
    main()
```

### pyproject.toml

```toml
[project]
name = "aihydro-floodfreq"
version = "0.1.0"
dependencies = [
    "fastmcp>=2.0.0",
    "scipy>=1.11.0",
    "lmoments3>=1.0.0",
]

[project.scripts]
aihydro-floodfreq = "aihydro_floodfreq.server:main"
```

---

## Registering with AI-Hydro

After installation, the user registers the server in `aihydro_mcp_settings.json`:

```json
{
  "mcpServers": {
    "ai-hydro": {
      "command": "aihydro-mcp",
      "args": []
    },
    "aihydro-floodfreq": {
      "command": "aihydro-floodfreq",
      "args": []
    }
  }
}
```

Or via the VS Code extension MCP settings panel — add server → enter command `aihydro-floodfreq`.

---

## Sharing State with HydroSession

Path A servers can still read/write HydroSession by importing `aihydro-tools`:

```python
from ai_hydro.session import HydroSession

def fit_flood_frequency(gauge_id: str, distribution: str = "gev") -> dict:
    session = HydroSession.load(gauge_id)
    q = session.streamflow["annual_maxima"]
    # ... fit distribution ...
    session.set_slot("flood_freq", results, meta)
    session.save()
    return results
```

Since both servers write to the same `~/.aihydro/sessions/` directory, results from your server are accessible to the core `aihydro-mcp` tools in the same conversation.
