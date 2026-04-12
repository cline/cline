# AI-Hydro Tool Usage — Behavioral Rules

> The full list of available tools is in `.clinerules/tools.md` (auto-generated).
> This file contains only stable behavioral rules — it never needs updating
> when new tools are added.

---

## Core rule: MCP first, Python as fallback for gaps

**If an MCP tool exists for the task → use it. Never substitute Python.**
**If no MCP tool exists → Python scripting via `execute_command` is the correct fallback.**

Check the `ai-hydro` MCP server first. If the tool is there, call it.
If not, write a Python script and note the gap.

---

## Session workflow

1. **Start with `delineate_watershed(gauge_id, workspace_dir="<path>")`** — this
   creates the session, sets the workspace, fetches the boundary, saves the
   GeoJSON file, and caches geometry for all downstream tools.

2. **All other tools take only `gauge_id`** — geometry is loaded from session
   automatically. Never pass coordinate arrays between tools.

3. **Files are saved by the server** — when `_file_saved` appears in a tool
   response, the file is already on disk. Do not call `write_file`.

4. **`start_session` is optional** — only needed if you want to check what's
   already been computed before running anything.

---

## Rules

1. **NEVER** run `python3 -c "from ai_hydro..."` — use MCP tools.
2. **NEVER** call `pip install` — dependencies live in the MCP server environment.
3. **NEVER** use `write_file` to write GeoJSON coordinates or large data arrays —
   this burns tokens and fills the editor diff with coordinates. The server writes
   these files automatically when `workspace_dir` is set.
4. Results are **automatically cached** in the session — no need to re-run tools.
5. When unsure what's been computed, call `get_session_summary(gauge_id)`.

---

## Anti-patterns

```
# WRONG — direct Python import
execute_command: python3 -c "from ai_hydro.tools.watershed import ..."

# WRONG — wastes tokens writing coordinate arrays through the editor
write_file(path="watershed.geojson", content="[[[-69.39, 45.10], ...")

# WRONG — pip install (deps are pre-installed in the server env)
execute_command: pip install pygeohydro
```

## Correct pattern — one call to start, then gauge_id only

```
# ONE call to begin everything
delineate_watershed("01031500", workspace_dir="/path/to/workspace")
# → creates session, sets workspace, fetches boundary, saves GeoJSON to disk
# → response: {area_km2, gauge_name, lat, lon} — NO coordinate arrays

# Data retrieval tools: gauge_id + date range
fetch_streamflow_data("01031500", "2000-01-01", "2010-12-31")
fetch_forcing_data("01031500", "2000-01-01", "2010-12-31")

# Analysis tools: gauge_id only
extract_hydrological_signatures("01031500")
extract_camels_attributes("01031500")
extract_geomorphic_parameters("01031500")
compute_twi("01031500")

# AI modelling (requires watershed + forcing cached)
train_hydro_model("01031500")                                    # HBV-light (default)
train_hydro_model("01031500", framework="neuralhydrology")       # LSTM

# Retrieve cached model performance
get_model_results("01031500")

# Session management
get_session_summary("01031500")   # what's computed vs pending
export_session("01031500", format="methods")   # paper-ready paragraph
```
