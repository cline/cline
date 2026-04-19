---
description: Glossary of hydrology and AI-Hydro terms — BFI, NSE, KGE, HBV, MCP, HydroResult, ProjectSession, capsule export, and other vocabulary used across the docs.
---

# Glossary

A short reference for hydrology, machine-learning, and AI-Hydro-specific terms used throughout this documentation. Items are alphabetised.

---

### `aihydro-mcp`

The Model Context Protocol server bundled with `aihydro-tools`. Started by the VS Code extension automatically; can also be launched standalone with `aihydro-mcp` for use with any MCP-compatible client.

### `.aihydroignore`

Workspace-level file (similar to `.gitignore`) that excludes paths from being read by the agent. Useful for keeping large rasters, secrets, or cached datasets out of the agent's view.

### `.aihydrorules/`

Project-local folder containing rules, hooks, workflows, and the auto-injected `research.md` file. Anything inside is included in every conversation, so this is where you put project-specific context the agent should always know.

### Baseflow Index (BFI)

Fraction of total streamflow that comes from baseflow (slow, groundwater-fed) rather than direct runoff. Computed in AI-Hydro using the Lyne–Hollick recursive digital filter (α=0.925, 3 passes). Range: 0–1.

### CAMELS

**Catchment Attributes and MEteorology for Large-Sample studies.** A widely used benchmark dataset of US (CAMELS-US, 671 basins), GB, BR, AUS, CL, and CH catchments. AI-Hydro fetches CAMELS-US attributes via `fetch_camels_us`.

### Capsule export

Default output of `export_session`. A self-contained folder (`capsule_<session_id>/`) with `README.md`, `methods.md`, `citations.bib`, raw `session.json`, the `data/` and `figures/` referenced inside, and an `environment.yml`. Designed to be zipped and attached to a paper, repo, or grant report.

### CN grid (Curve Number grid)

Spatial grid of SCS Curve Numbers used in event-based runoff modelling. AI-Hydro builds CN grids from NLCD land cover plus Polaris hydrologic soil groups via `create_cn_grid`.

### CONUS

**Conterminous United States** — the lower 48 states. Most current AI-Hydro data tools target CONUS as their primary coverage area.

### Flow duration curve (FDC)

Cumulative-frequency curve of daily flows. Several signatures derive from it: `q5`, `q95`, `slope_fdc` (the slope between Q33 and Q66 on log-flow vs. exceedance probability — a flashiness indicator).

### `flow_variability`

Day-to-day coefficient of variation of streamflow (σ / μ). Higher values indicate flashier basins. Returned by `extract_hydrological_signatures` (formerly named `q_cv`).

### HBV-light

A conceptual rainfall-runoff model with 4 storage compartments and ~10–14 calibration parameters. AI-Hydro implements an autograd-friendly PyTorch port via `train_hydro_model(model="hbv")`.

### HydroMeta

The provenance object attached to every `HydroResult`. Records tool name, version, data source(s), parameters used, timestamp, and any warnings — so any later session, capsule, or methods paragraph can cite where every number came from.

### HydroResult

The single return type that every AI-Hydro tool produces. A pair of `(data, meta)` where `data` is the scientific payload (numbers, GeoJSON, arrays, file paths) and `meta` is a `HydroMeta` provenance record. Enforced by the [Data Contract](plugins/data-contract.md).

### Kling–Gupta Efficiency (KGE)

Goodness-of-fit metric decomposing model error into correlation, bias, and variability components. Range: −∞ to 1; KGE = 1 is perfect. Often preferred over NSE because it doesn't over-penalise low-flow errors.

### LULC

**Land Use / Land Cover.** AI-Hydro uses NLCD (National Land Cover Database) for CONUS land cover, accessed inside `create_cn_grid`.

### MCP

**Model Context Protocol** — Anthropic's open standard for connecting AI agents to external tool servers. AI-Hydro ships its hydrology toolkit as an MCP server (`aihydro-mcp`) so the same tools work in VS Code, Claude Desktop, Cursor, or any other MCP-aware client.

### NLCD

**National Land Cover Database** (USGS / MRLC). 30 m gridded land-cover product for CONUS. Used by AI-Hydro's `create_cn_grid` tool.

### NLDI / NHDPlus

USGS hydrography services. **NLDI** (Network-Linked Data Index) handles upstream/downstream navigation; **NHDPlus** provides the underlying flowline and catchment geometry. Used by `delineate_watershed` and gauge-attribute lookups.

### Nash–Sutcliffe Efficiency (NSE)

Classic hydrological model fit metric. Range: −∞ to 1. NSE = 1 is perfect; NSE > 0 means the model beats predicting the mean. AI-Hydro returns NSE alongside KGE and percent bias from `get_model_results`.

### Polaris

USDA SSURGO-derived soils dataset at 30 m for CONUS, providing hydrologic soil groups and other physical properties. Accessed inside `create_cn_grid`.

### ProjectSession

A multi-gauge research workspace (`~/.aihydro/projects/<slug>/`) that organises sessions, notes, and experiments across many basins. Created with `start_project`. Project names are slugs: `^[a-zA-Z0-9_-]{1,64}$`.

### Provenance

The chain of evidence (data source, version, parameters, timestamp) attached to every result. AI-Hydro enforces provenance via the `HydroMeta` object so claims in the agent's prose can always be traced back to a tool call.

### `pygeohydro` / `pynhd` / `pygridmet` / `py3dep` / `pysheds`

The HyRiver and related Python libraries AI-Hydro builds on for USGS streamflow, NHDPlus hydrography, GridMET forcings, 3DEP elevation, and D8 flow routing respectively.

### Researcher Profile

A persistent persona (`~/.aihydro/profile/profile.json`) recording your stated expertise, preferred providers, and recurring research focus. Auto-loaded into every conversation so you don't repeat yourself.

### Runoff ratio

Mean annual streamflow divided by mean annual precipitation. Dimensionless, typically 0.05–0.95 for natural basins. Returned by `extract_hydrological_signatures`.

### Session capsule

See **Capsule export**.

### Topographic Wetness Index (TWI)

`ln(α / tan β)`, where α is upslope contributing area and β is local slope. AI-Hydro computes TWI from a 3DEP DEM via `py3dep`, with flow direction and accumulation from `pysheds` (D8 algorithm). Higher TWI = wetter / more saturation-prone cells.

### USGS gauge ID

8-digit (or longer for some sub-codes) identifier for a USGS streamflow station — e.g. `01031500`. Used as the canonical handle for sessions: `start_session("01031500")` → folder `~/.aihydro/sessions/01031500/`.
