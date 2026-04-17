---
description: How AI-Hydro records provenance automatically — HydroSession, ProjectSession, and ResearcherProfile explained with JSON schema examples.
---

# Sessions & Provenance

AI-Hydro automatically records every analysis step with structured metadata — data source, parameters, timestamp, tool version — transforming reproducibility from an afterthought into a natural byproduct of the research process.

---

## The Memory Hierarchy

AI-Hydro maintains three tiers of persistent state:

```
ResearcherProfile          ← who you are (global, persists forever)
    └── ProjectSession     ← what you're working on (per project)
            └── HydroSession  ← what was computed (per gauge)
```

Each tier survives across VS Code sessions, restarts, and days or weeks between conversations.

---

## HydroSession

**What it is:** Per-gauge research state. One JSON file per USGS gauge.

**Storage:** `~/.aihydro/sessions/<gauge_id>.json`

**What it tracks:**

| Slot | Content |
|------|---------|
| `watershed` | Delineation geometry, area, perimeter |
| `streamflow` | Date range, record count, mean discharge |
| `signatures` | All flow statistics with computation timestamp |
| `geomorphic` | 28 morphometry metrics |
| `twi` | TWI raster path and statistics |
| `cn` | Curve number grid path |
| `forcing` | GridMET data path and variable list |
| `model` | Model type, performance metrics, parameter set |
| `notes` | Researcher-added text notes |

**Why it matters:** Watershed delineation takes ~10 seconds. Fetching 20 years of streamflow takes ~5 seconds. These are done **once**, cached, and reused across every future conversation. The agent never re-downloads data you already have.

### Provenance Metadata

Every result slot contains a `meta` object:

```json
{
  "watershed": {
    "data": { "area_km2": 1247.3, ... },
    "meta": {
      "tool": "delineate_watershed",
      "version": "1.2.0",
      "source": "USGS NLDI / NHDPlus",
      "retrieved_at": "2026-04-10T09:14:22Z",
      "parameters": { "gauge_id": "01031500" }
    }
  }
}
```

This metadata is what `export_session` uses to generate citable methods paragraphs.

---

## Session Tool Reference

### `start_session`

Initialise or resume a session for a gauge.

```
Start a session for gauge 01031500.
```

If a session already exists, it is loaded — existing results remain intact.

As of v0.1.4, the response also includes the **Python environment context**:

```json
{
  "gauge_id": "01031500",
  "computed": [],
  "pending": ["watershed", "streamflow", ...],
  "mcp_python": "/opt/miniconda3/bin/python",
  "mcp_pip": "/opt/miniconda3/bin/pip",
  "available_packages": {
    "numpy": "1.26.4",
    "pandas": "2.2.1",
    "pygeohydro": "0.16.2",
    ...
  }
}
```

The agent uses `mcp_python` as the interpreter for any Python scripts it writes — preventing the most common mistake of writing `#!/usr/bin/env python3` and running in the wrong environment.

### `get_session_summary`

Show what has been computed and what is still pending.

```
What have I already computed for gauge 01031500?
```

Returns a structured summary of all filled and empty slots.

### `clear_session`

Reset a slot or the entire session to force re-computation.

```
Clear the streamflow data for gauge 01031500 — I want to re-fetch with a longer date range.
```

### `add_note`

Attach a free-text research note to the session.

```
Note: the high BFI likely reflects the fractured bedrock geology of this basin.
```

### `export_session`

Generate a manuscript-ready methods paragraph.

```
Export the session for gauge 01031500 as a methods paragraph.
```

Output is written to `~/.aihydro/sessions/<gauge_id>_methods.txt` to preserve the context window.

### `sync_research_context`

Refresh the `.aihydrorules/research.md` file that injects session context into every conversation.

---

## Reproducibility Notes

!!! info "What sessions guarantee"
    Sessions record **what was computed, with what parameters, from what source, at what time**. This supports auditability and re-computation with the same parameters.

!!! warning "What sessions do not guarantee"
    Federal data APIs (USGS NWIS, GridMET, 3DEP) may update their records retroactively. A session records the retrieval timestamp, not a frozen snapshot of the upstream data. For fully frozen reproducibility, use `export_session` to save the actual data values alongside the provenance metadata.

---

## Next: Project Sessions

For research spanning multiple gauges or topics, see [Project Workspace](project-session.md).
