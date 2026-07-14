---
description: Experiment Table and Session Replay panels for auditing AI-Hydro analyses from persisted session state.
---

# Reproducibility Panels

AI-Hydro exposes audit panels in the VS Code extension. They are designed for
scientific review, not just UI convenience: each panel reads persisted session
state so experiments and tool runs can be inspected after the chat has moved
on.

Open them from the Command Palette or the sidebar toolbar:

| Panel | Command | Primary source |
|---|---|---|
| Experiment Table | `AI-Hydro: Experiment Table` | `~/.aihydro/sessions/<session_id>.json` or capsule `session.json` |
| Session Replay | `AI-Hydro: Session Replay` | `~/.aihydro/sessions/<session_id>.json` or capsule `session.json` |

Use the bundled demo fixture for a populated end-to-end smoke test:

```bash
mkdir -p ~/.aihydro/sessions
cp examples/reproducibility-panels/demo-reproducibility-cockpit.json \
  ~/.aihydro/sessions/demo-reproducibility-cockpit.json
```

Then load session `demo-reproducibility-cockpit` in either panel (Experiment
Table also needs experiment id `panel_smoke_exp`). The fixture is
intentionally illustrative for UI/UX validation; it is not publication
evidence.

## Experiment Table

The Experiment Table loads an experiment from a persisted HydroSession and renders a metric table across features/basins.

It expects a session slot shaped like:

```json
{
  "_experiments": {
    "data": {
      "experiment_id": {
        "defn": {
          "name": "...",
          "tool": "...",
          "features": ["01031500", "01109000"],
          "metrics": ["kge", "nse"]
        },
        "results": {
          "status": "complete",
          "run_ids": { "01031500": "run.01031500" },
          "cells": {
            "01031500": { "kge": { "value": 0.73 } }
          },
          "errors": {}
        }
      }
    }
  }
}
```

The panel supports:

- recent-session suggestions from `~/.aihydro/sessions/`;
- direct session id, explicit JSON path, or capsule directory path;
- sorted metric columns;
- compact value + CI cells that hide empty uncertainty columns;
- pass/warn/fail badges for common skill metrics such as KGE/NSE;
- cross-feature aggregate statistics;
- click-to-highlight for matching map layers (`metadata.feature_id`, layer name, or layer id);
- run chips that open Session Replay focused on the backing run.

If an experiment id is wrong, the host response lists available experiment ids.

## Session Replay

Session Replay turns `_run_log` into a chronological audit timeline. It supports both wrapped map slots and arrays:

```json
{
  "_run_log": {
    "data": {
      "run1": {
        "tool_name": "delineate_watershed",
        "timestamp": "2026-06-25T00:01:00Z",
        "key_outputs": {
          "area_km2": 113.27,
          "_quality_flags": [
            { "validator": "area_range", "status": "pass" }
          ]
        }
      }
    }
  }
}
```

The panel supports:

- recent-session suggestions;
- direct session id, JSON path, or capsule directory path;
- chronological sorting by timestamp/run id;
- filtering by tool name, run id, or basin id;
- review chips for `All`, `Needs review`, and `Failed`;
- keyboard navigation (`↑`, `↓`, `Esc`);
- focused-run opening from Experiment Table run chips;
- quality-flag and diff-status badges.

`_run_log` records tool name, timestamp, and a lean, size-capped
`key_outputs` snapshot, plus — for tools that opt in via
`post_run(..., inputs={...})` — a scrubbed `inputs` dict of the call's own
scalar kwargs (secret-shaped keys and long strings such as inline GeoJSON
are dropped or length-only; see `_scrub_tool_inputs` in
`aihydro-tools/ai_hydro/mcp/enforcement.py`). As of this writing, 4 tools
(`fetch_streamflow_data`, `extract_hydrological_signatures`,
`map_flood_inundation`, `map_flood_inundation_hydrograph`) record inputs;
most Tier 1 tools do not yet. Replay still does not record which prior
run's output a run depended on (no `upstream_run_ids`) — that remains a
per-run audit trail, not a full provenance graph; see the extension
feature audit (`audits/extension-feature-audit-2026-07-09.md`, ecosystem
root, finding F-2) for the full picture and the plan for the rest.

## Shared file-contract reader

The extension host uses `src/integrations/aihydro-session/sessionSurfaces.ts` to resolve and parse these surfaces. Unit tests lock the cross-language contract in `src/integrations/aihydro-session/__tests__/sessionSurfaces.test.ts`.
