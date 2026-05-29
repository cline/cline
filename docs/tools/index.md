---
description: AI-Hydro built-in MCP tools — 110+ hydrology tools for analysis, modelling, provenance, map, skills, GEE, and session management, all returning provenance-tracked HydroResult objects.
---

# Tool Reference

All tools are exposed via the [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) and can be called by any compatible AI agent. The agent decides which tools to call — you describe what you want to understand, and the agent orchestrates the right sequence.

---

## Tool Categories

| Category | Representative tools | Description |
|----------|---------------------|-------------|
| [Analysis Tools](analysis.md) | `delineate_watershed`, `fetch_streamflow_data`, `extract_hydrological_signatures`, `compute_twi`, `separate_baseflow`, `create_cn_grid` | Data retrieval, watershed characterisation, terrain, baseflow |
| [Modelling Tools](modelling.md) | `train_hydro_model`, `get_model_results` | HBV-light, NeuralHydrology LSTM calibration and results |
| [Project & Literature](project.md) | `start_project`, `index_literature`, `search_literature`, `add_journal_entry`, `get_researcher_profile` | Projects, literature indexing, researcher persona |
| [Session Tools](session.md) | `start_session`, `get_session_summary`, `export_session`, `merge_session_shards` | Session management, provenance, multi-agent orchestration |
| **Skills** | `list_skills`, `load_skill`, `save_skill` | Workflow playbook discovery and management |
| **Map** | `show_on_map`, `map_update_layer`, `map_apply_symbology`, `map_get_state` | Geospatial layer management in the Map panel |
| **HTML Preview** | `show_html_preview` | Open HTML artifacts in the built-in preview panel |
| **Google Earth Engine** | `gee.status`, `gee.preview_layer`, `gee.extract_timeseries` | Cloud-scale satellite and raster analysis (requires GEE connector) |
| **Provenance** | `add_claim`, `add_assumption`, `check_water_balance_consistency`, `check_temporal_alignment` | Scientific claim tracking and consistency validation |
| **Discovery** | `list_available_tools`, `get_variable_definition`, `get_metric_definition`, `get_library_reference` | In-context reference lookups |

**Total: 113 built-in tools** (16 Tier-1 core, 36 Tier-2 extended, 61 Tier-3 specialist). See the **[Complete Reference](reference.md)** for every tool with its parameters and a worked example, auto-generated from the live server. Call `list_available_tools()` at runtime for the live count on your installation — community plugins add more.

---

## Quick Tool Index

### Analysis & Data

| Tool | Source | What it returns |
|------|--------|-----------------|
| `delineate_watershed` | USGS NLDI / NHDPlus | Catchment polygon, area, HUC code, gauge coordinates |
| `delineate_watershed_from_point` | USGS NLDI / NHDPlus | Same as above but takes a lat/lon instead of gauge ID |
| `fetch_streamflow_data` | USGS NWIS | Daily discharge time series |
| `extract_hydrological_signatures` | In-session | 15+ flow statistics (BFI, runoff ratio, FDC slopes, flashiness) |
| `extract_geomorphic_parameters` | 3DEP DEM | 28 basin morphometry metrics |
| `compute_twi` | 3DEP DEM | Topographic Wetness Index raster |
| `create_cn_grid` | NLCD + Polaris | NRCS Curve Number raster |
| `separate_baseflow` | In-session | Lyne-Hollick and Eckhardt baseflow separation with BFI |
| `fetch_forcing_data` | GridMET (CONUS) | Basin-averaged precipitation, temperature, PET, solar radiation |
| `fetch_camels_us` | pygeohydro | Full CAMELS-US attribute set for 671 CONUS gauges |

### Modelling

| Tool | What it does |
|------|--------------|
| `train_hydro_model` | Calibrate HBV-light (differentiable) or NeuralHydrology LSTM |
| `get_model_results` | Retrieve cached NSE / KGE / RMSE and hydrograph data |
| `get_training_status` | Poll async training job progress |

### Skills

| Tool | What it does |
|------|--------------|
| `list_skills` | List all installed workflow playbooks (mandatory pre-flight before planning) |
| `load_skill` | Load full SKILL.md content; agent follows it as the governing plan |
| `save_skill` | Save a novel workflow as a reusable skill |

### Map

| Tool | What it does |
|------|--------------|
| `show_on_map` | Add any GeoJSON to the Map panel with style and label |
| `map_get_state` | Read current map state: basemap, view, layer catalog with IDs |
| `map_list_layers` | Layer catalog only (faster than full state) |
| `map_update_layer` | Update style, visibility, or name of an existing layer by ID |
| `map_apply_symbology` | Graduated (choropleth) symbology by attribute |
| `map_remove_layer` | Remove a layer from the map |
| `map_set_basemap` | Change basemap |
| `map_fit_layer` / `map_fit_extent` | Zoom the map viewport |

### Provenance & Validation

| Tool | What it does |
|------|--------------|
| `add_claim` | Record a scientific claim with evidence and confidence |
| `add_assumption` | Record an analysis assumption for the methods section |
| `promote_claim_to_registry` | Elevate a validated claim to the project-wide registry |
| `draft_claim_from_run` | Auto-draft a claim from a completed tool run |
| `check_water_balance_consistency` | Flag water balance violations |
| `check_temporal_alignment` | Verify time series alignment across data sources |
| `check_unit_consistency` | Catch unit mismatches before they propagate |

### Discovery & Reference

| Tool | What it does |
|------|--------------|
| `list_available_tools` | Live list of all registered tools including community plugins |
| `get_variable_definition` | Lookup standard definition, units, and conventions for a variable |
| `list_known_variables` | All variables in the AI-Hydro ontology |
| `get_metric_definition` | Definition, formula, and interpretation guidance for a metric |
| `get_dataset_info` | Dataset metadata: extent, resolution, citation, access |
| `get_equation_definition` | Equation definition with parameter descriptions |
| `get_library_reference` | API reference card for a Python library |
| `list_relevant_clis` | CLIs relevant to a task type |

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
