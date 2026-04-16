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

**Returns:** Watershed polygon geometry, area (km²), perimeter (km), centroid coordinates, bounding box.

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

**Data source:** USGS NWIS via [hydrofunctions](https://hydrofunctions.readthedocs.io/)

---

## `extract_hydrological_signatures`

Compute 15+ flow statistics from the cached streamflow record.

**Requires:** `fetch_streamflow_data` to have been called first.

**Signatures returned:**

| Signature | Description |
|-----------|-------------|
| `baseflow_index` (BFI) | Fraction of streamflow from baseflow (Eckhardt filter) |
| `runoff_ratio` | Mean annual runoff / mean annual precipitation |
| `mean_annual_discharge` | m³/s |
| `cv_daily_discharge` | Coefficient of variation of daily discharge |
| `q5`, `q25`, `q50`, `q75`, `q95` | Flow duration curve percentiles |
| `fdc_slope` | Slope of FDC between Q33 and Q66 |
| `high_flow_freq` | Days per year above 9× median flow |
| `low_flow_freq` | Days per year below 0.2× mean flow |
| `recession_constant` | Mean daily recession rate |
| `rising_limb_density` | Rise events per unit time |

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
