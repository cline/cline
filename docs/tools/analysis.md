---
description: Reference for AI-Hydro analysis tools: delineate_watershed, fetch_streamflow_data, extract_hydrological_signatures, compute_twi, extract_geomorphic_parameters, and more.
---

# Analysis Tools

Tools for data retrieval, watershed characterisation, and hydrological analysis.

---

## `delineate_watershed`

Delineate the upstream watershed for a USGS gauge using NHDPlus and the USGS NLDI API.

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `gauge_id` | str | Yes | USGS gauge ID (e.g., `"01031500"`) |
| `workspace_dir` | str | No | Absolute path to workspace — all output files saved here automatically. Pass once; remembered for all subsequent tools. |

**Returns:** Watershed area (km²), gauge coordinates, HUC-02 code, bounding box. Geometry is stored in session and saved to disk — never passed through the LLM context.

**Files saved automatically (when `workspace_dir` set):**

| File | Description |
|------|-------------|
| `watershed_<id>.geojson` | Full watershed polygon (WGS84) |
| `watershed_<id>_map.png` | Boundary map with gauge location marker |

**Data source:** USGS NLDI / NHDPlus via [pynhd](https://hyriver.readthedocs.io/en/latest/pynhd.html)

**Example:**
```
Delineate the watershed for gauge 01031500.
```

---

## `fetch_streamflow_data`

Retrieve daily discharge time series from the USGS National Water Information System (NWIS).

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `gauge_id` | str | Yes | USGS gauge ID |
| `start_date` | str | No | ISO date, e.g. `"2000-01-01"` (default: 20 years ago) |
| `end_date` | str | No | ISO date (default: today) |

**Returns:** Daily discharge array (m³/s), date range, record count, missing-data statistics.

**Files saved automatically (when workspace set):**

| File | Description |
|------|-------------|
| `streamflow_<id>.json` | Full time series with dates and discharge values |
| `hydrograph_<id>.png` | Daily hydrograph with 30-day rolling mean overlay |

**Data source:** USGS NWIS via [dataretrieval](https://doi-usgs.github.io/dataretrieval-python/)

---

## `extract_hydrological_signatures`

Compute 15+ flow statistics from the cached streamflow record.

**Requires:** `fetch_streamflow_data` to have been called first.

**Signatures returned:**

| Signature | Description |
|-----------|-------------|
| `baseflow_index` (BFI) | Fraction of streamflow from baseflow (Eckhardt filter) |
| `runoff_ratio` | Mean annual runoff / mean annual precipitation |
| `q_mean` | Mean daily discharge (mm/day) |
| `q_cv` | Coefficient of variation of daily discharge |
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
| `signatures_<id>.json` | All computed signatures with metadata |
| `fdc_<id>.png` | Log-scale flow duration curve + signature summary table |

---

## `extract_geomorphic_parameters`

Compute 28 basin morphometry metrics from the watershed geometry and DEM.

**Requires:** `delineate_watershed` to have been called first.

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

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `gauge_id` | str | Yes | USGS gauge ID |
| `resolution` | int | No | DEM resolution in metres (default: 10) |

**Returns:** TWI raster path, mean TWI, standard deviation, high-wetness area fraction.

**Data source:** 3DEP via py3dep + [xrspatial](https://xarray-spatial.readthedocs.io/)

---

## `create_cn_grid`

Generate a NRCS Curve Number grid by combining NLCD land cover and Polaris soil texture data.

**Returns:** CN raster path, mean CN, area-weighted CN statistics by land cover class.

**Data sources:** NLCD (land cover) + Polaris (soil texture) via pygeohydro

---

## `fetch_forcing_data`

Retrieve basin-averaged daily climate data from the GridMET dataset.

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `gauge_id` | str | Yes | USGS gauge ID |
| `start_date` | str | No | ISO date |
| `end_date` | str | No | ISO date |

**Variables returned:** precipitation, tmax, tmin, reference ET (PET), solar radiation, wind speed, humidity.

**Data source:** [GridMET](https://www.climatologylab.org/gridmet.html) via [pygridmet](https://hyriver.readthedocs.io/en/latest/pygridmet.html)

---

## `extract_camels_attributes`

Retrieve the full CAMELS-US attribute set for a gauge from the 671-basin benchmark dataset.

**Returns:** Topographic, climatic, soil, vegetation, hydrological, and geological attributes (~60 variables).

**Data source:** CAMELS-US via [pygeohydro](https://hyriver.readthedocs.io/en/latest/pygeohydro.html)

!!! note
    Only available for the 671 gauges in the CAMELS-US dataset. Returns an error for gauges not in CAMELS.

!!! info "Subprocess isolation"
    This tool runs the CAMELS extractor in a separate child process. External API calls inside the extractor cannot crash the MCP server — the server stays alive even if the extraction fails or times out (180s limit).

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
