---
description: Reference for AI-Hydro analysis tools: delineate_watershed, fetch_streamflow_data, extract_hydrological_signatures, compute_twi, extract_geomorphic_parameters, and more.
---

# Analysis Tools

Tools for data retrieval, watershed characterisation, and hydrological analysis.

!!! info "Source-specific vs source-agnostic"
    **Data tools** (source-specific) fetch from a particular data system and are honest about their limits:
    `delineate_watershed` (USGS NLDI), `fetch_streamflow_data` (USGS NWIS),
    `fetch_forcing_data` (GridMET / CONUS only).

    **Analysis tools** (source-agnostic) work on any data already in the session:
    `extract_hydrological_signatures`, `extract_geomorphic_parameters`, `compute_twi`, `create_cn_grid`.

    For data not covered by built-in tools (GRDC, CWC, BOM, user CSV, remote sensing), write a Python
    script via `mcp_python` and store the result in the session with `session.set(slot, data)`.

---

## `delineate_watershed`

Delineate the upstream watershed for a USGS gauge using NHDPlus and the USGS NLDI API.

After delineation, the gauge ID is stored in `session.site_id` so all downstream tools resolve it automatically — you do not need to pass `gauge_id` again.

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `session_id` | str | Yes | Research session identifier — any string (slug, UUID, gauge ID used as shorthand) |
| `gauge_id` | str | No | 8-digit USGS station number, e.g. `"01031500"`. Resolved from `session.site_id` if omitted. |
| `workspace_dir` | str | No | Absolute path to workspace — all output files saved here automatically. Pass once; remembered for all subsequent tools. |

**Returns:** Watershed area (km²), gauge coordinates, HUC-02 code, bounding box. Geometry is stored in session and saved to disk — never passed through the LLM context.

**Files saved automatically (when `workspace_dir` set):**

| File | Description |
|------|-------------|
| `watershed_<gauge_id>.geojson` | Full watershed polygon (WGS84) |
| `watershed_<gauge_id>_map.png` | Boundary map with gauge location marker |

**Data source:** USGS NLDI / NHDPlus via [pynhd](https://hyriver.readthedocs.io/en/latest/pynhd.html)

**Examples:**
```
# New study — create a named session
delineate_watershed('piscataquis-snowmelt-2020', gauge_id='01031500',
                    workspace_dir='/path/to/workspace')

# gauge ID used directly as session_id (backward compatible)
delineate_watershed('01031500', workspace_dir='/path/to/workspace')
```

---

## `fetch_streamflow_data`

Retrieve daily discharge time series from the USGS National Water Information System (NWIS).

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `session_id` | str | Yes | Research session identifier |
| `gauge_id` | str | No | 8-digit USGS station number. Resolved from `session.site_id` if omitted (set by `delineate_watershed`). |
| `start_date` | str | Yes | ISO date, e.g. `"2000-01-01"` |
| `end_date` | str | Yes | ISO date, e.g. `"2020-12-31"` |
| `interval` | str | No | `"daily"` (default) or `"hourly"` |

**Returns:** Daily discharge array (m³/s), date range, record count, missing-data statistics.

**Files saved automatically (when workspace set):**

| File | Description |
|------|-------------|
| `streamflow_<gauge_id>.json` | Full time series with dates and discharge values |
| `hydrograph_<gauge_id>.png` | Daily hydrograph with 30-day rolling mean overlay |

**Data source:** USGS NWIS via [dataretrieval](https://doi-usgs.github.io/dataretrieval-python/)

---

## `extract_hydrological_signatures`

Compute 15+ flow statistics from the session's streamflow record.

**Requires:** `delineate_watershed` (and ideally `fetch_streamflow_data`) to have been called for this session first.

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `session_id` | str | Yes | Research session identifier |
| `start_date` | str | No | Analysis start (default: `"1989-10-01"`, CAMELS period) |
| `end_date` | str | No | Analysis end (default: `"2009-09-30"`, CAMELS period) |

**Signatures returned:**

| Signature | Description |
|-----------|-------------|
| `baseflow_index` (BFI) | Fraction of streamflow from baseflow (Lyne–Hollick recursive digital filter, α=0.925, 3 passes) |
| `runoff_ratio` | Mean annual runoff / mean annual precipitation |
| `q_mean` | Mean daily discharge (mm/day) |
| `flow_variability` | Coefficient of variation of daily discharge (σ/μ) |
| `q5`, `q95` | High-flow (5% exceedance) and low-flow (95% exceedance) |
| `slope_fdc` | Slope of FDC between Q33 and Q66 — flashiness indicator |
| `high_q_freq` | Days per year above 9× median flow |
| `low_q_freq` | Days per year below 0.2× mean flow |
| `high_q_dur` | Mean duration of high-flow events (days) |
| `low_q_dur` | Mean duration of low-flow events (days) |
| `zero_q_freq` | Fraction of days with zero flow |
| `hfd_mean` | Half-flow date — day of year by which 50% of annual flow has passed |
| `stream_elas` | Streamflow elasticity to precipitation |

**Files saved automatically (when workspace set):**

| File | Description |
|------|-------------|
| `signatures_<session_id>.json` | All computed signatures with metadata |
| `fdc_<session_id>.png` | Log-scale flow duration curve + signature summary table |

---

## `extract_geomorphic_parameters`

Compute 28 basin morphometry metrics from the watershed geometry and DEM.

**Requires:** `delineate_watershed` to have been called for this session first.

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `session_id` | str | Yes | Research session identifier |
| `dem_resolution` | int | No | DEM resolution in metres (default: 30) |

**Selected parameters:**

| Parameter | Description |
|-----------|-------------|
| `area_km2` | Watershed area |
| `perimeter_km` | Watershed perimeter |
| `mean_elevation_m` | Basin-averaged elevation (3DEP) |
| `mean_slope_deg` | Basin-averaged slope |
| `relief_m` | Max − min elevation |
| `elongation_ratio` | Circularity measure |
| `drainage_density` | Total stream length / area |
| `form_factor` | Area / (main channel length²) |

**Data source:** 3DEP 10m DEM via [py3dep](https://hyriver.readthedocs.io/en/latest/py3dep.html)

---

## `compute_twi`

Compute the Topographic Wetness Index (TWI) raster from the 3DEP DEM.

`TWI = ln(α / tan(β))` where α is specific catchment area and β is local slope.

**Requires:** `delineate_watershed` to have been called for this session first.

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `session_id` | str | Yes | Research session identifier |
| `resolution` | int | No | DEM resolution in metres (default: 30) |
| `create_map` | bool | No | Generate PNG + interactive HTML map (default: True) |

**Returns:** TWI statistics (mean, std, percentiles, high-wetness area fraction). Raster and map files written to workspace.

**Data source:** 3DEP DEM via [py3dep](https://hyriver.readthedocs.io/en/latest/py3dep.html); flow direction and accumulation via [pysheds](https://github.com/mdbartos/pysheds) (D8 algorithm)

---

## `create_cn_grid`

Generate a NRCS Curve Number grid by combining NLCD land cover and Polaris soil texture data.

**Requires:** `delineate_watershed` to have been called for this session first.

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `session_id` | str | Yes | Research session identifier |
| `year` | int | No | NLCD land cover year (default: 2019) |
| `resolution` | int | No | Grid resolution in metres (default: 30) |
| `create_map` | bool | No | Generate PNG + interactive HTML map (default: True) |

**Returns:** Mean CN, area-weighted CN statistics by land cover class, soil group percentages.

**Data sources:** NLCD (land cover) + Polaris (soil texture) via pygeohydro

---

## `fetch_forcing_data`

Retrieve basin-averaged daily climate data from the GridMET dataset (CONUS only).

**Requires:** `delineate_watershed` to have been called for this session first.

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `session_id` | str | Yes | Research session identifier |
| `start_date` | str | Yes | ISO date |
| `end_date` | str | Yes | ISO date |
| `variables` | list[str] | No | Subset of GridMET variables (default: all). Options: `pr`, `tmmx`, `tmmn`, `srad`, `vs`, `rmax`, `rmin`, `pet`, `erc` |

**Variables returned:** precipitation, tmax, tmin, reference ET (PET), solar radiation, wind speed, humidity.

**Data source:** [GridMET](https://www.climatologylab.org/gridmet.html) via [pygridmet](https://hyriver.readthedocs.io/en/latest/pygridmet.html)

!!! note
    GridMET covers the contiguous United States (CONUS) only. For other regions, retrieve forcing data via `mcp_python` using ERA5, MSWEP, or other global datasets and store in the session.

---

## `get_library_reference`

Look up field-name gotchas, API quirks, unit assumptions, and copy-paste code patterns for a core hydrological Python library.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `library` | str | Yes | Library name (case-insensitive). See supported libraries below. |

**Supported libraries:**

| Library | Purpose |
|---------|---------|
| `pynhd` | NLDI watershed polygons and NHD data |
| `pygeohydro` | USGS NWIS streamflow and NLCD land cover |
| `pygridmet` | GridMET daily climate (precipitation, temperature) |
| `py3dep` | 3DEP elevation (DEM) access |
| `hydrofunctions` | Simple NWIS streamflow client |
| `pysheds` | DEM-based flow direction, accumulation, TWI |
| `rasterio` | Raster I/O, masking, reprojection |
| `xarray` | N-dimensional labeled arrays for gridded data |

**When to use:** Call this before writing any Python script that uses one of these libraries. It returns the exact field names, CRS requirements, unit conventions, and common mistakes — preventing hallucination errors in generated scripts.

**Returns:** `library`, `purpose`, `field_mappings` (function-level notes), `gotchas` (list), `common_patterns` (copy-paste snippets).

Community plugins can extend this via the `aihydro.knowledge` entry point — see [Plugin Guide](../plugins/overview.md).
