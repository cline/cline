# Tools Reference

All tools are available as MCP tools (called by the AI agent) and as importable Python functions.

**Performance note**: All results are automatically cached in the [HydroSession](#session-tools). Re-calling a tool for a gauge that already has a cached result is instant.

---

## Watershed Tools

### `delineate_watershed`

Delineates the upstream watershed for a USGS stream gauge using USGS NLDI and NHDPlus v2.

**Parameters**

| Name | Type | Default | Description |
|------|------|---------|-------------|
| `gauge_id` | str | required | 8-digit USGS NWIS site ID (e.g. `"01031500"`) |

**Returns**

```json
{
  "gauge_id": "01031500",
  "gauge_name": "Piscataquis River near Dover-Foxcroft, ME",
  "area_km2": 769.0,
  "perimeter_km": 247.3,
  "huc_02": "01",
  "centroid_lat": 45.18,
  "centroid_lon": -69.22,
  "geometry": { ... },   // GeoJSON polygon
  "meta": { ... }        // FAIR provenance
}
```

**Example**

```python
from ai_hydro.tools.watershed import delineate_watershed
result = delineate_watershed("01031500")
print(result["area_km2"])  # 769.0
```

---

## Streamflow Tools

### `fetch_streamflow_data`

Downloads daily mean discharge from USGS NWIS for a given period.

**Parameters**

| Name | Type | Default | Description |
|------|------|---------|-------------|
| `gauge_id` | str | required | USGS NWIS site ID |
| `start_date` | str | `"2000-01-01"` | ISO 8601 start date |
| `end_date` | str | `"2010-12-31"` | ISO 8601 end date |

**Returns**

```json
{
  "n_days": 3652,
  "start": "2000-01-01",
  "end": "2010-12-31",
  "q_mean_mm_day": 1.84,
  "q_max_mm_day": 28.3,
  "n_missing": 0,
  "timeseries": { "2000-01-01": 1.2, ... }
}
```

---

## Signature Tools

### `extract_hydrological_signatures`

Computes 15+ catchment hydrological signatures from a streamflow record.

**Parameters**

| Name | Type | Default | Description |
|------|------|---------|-------------|
| `gauge_id` | str | required | USGS NWIS site ID |
| `start_date` | str | optional | Subset period start |
| `end_date` | str | optional | Subset period end |

Requires `streamflow` to be cached in the session (call `fetch_streamflow_data` first).

**Returns**

```json
{
  "q_mean": 1.84,
  "baseflow_index": 0.61,
  "runoff_ratio": 0.53,
  "q_cv": 1.82,
  "high_q_freq": 12.3,
  "high_q_dur": 4.2,
  "low_q_freq": 8.1,
  "low_q_dur": 41.0,
  "zero_q_freq": 0.0,
  "fdc_slope": 2.14,
  "stream_elasticity": 1.73,
  "q5": 0.08,
  "q95": 7.42
}
```

---

## Geomorphic Tools

### `extract_geomorphic_parameters`

Computes 28 basin morphometry metrics (elongation ratio, form factor, relief ratio, hypsometric integral, etc.) from a DEM.

**Parameters**

| Name | Type | Default | Description |
|------|------|---------|-------------|
| `gauge_id` | str | required | USGS NWIS site ID |
| `resolution` | int | `30` | DEM resolution in meters (10, 30, 90) |

Requires `watershed` to be cached.

**Returns** (selected fields)

```json
{
  "elongation_ratio": 0.71,
  "form_factor": 0.42,
  "circularity_ratio": 0.58,
  "relief_ratio": 0.019,
  "hypsometric_integral": 0.44,
  "mean_slope_pct": 12.3,
  "elev_mean_m": 412.0,
  "elev_max_m": 688.0,
  "elev_min_m": 124.0,
  "drainage_density": 0.83
}
```

---

## Terrain Tools

### `compute_twi`

Computes the Topographic Wetness Index (TWI = ln(a / tan β)) from the 3DEP DEM.

**Parameters**

| Name | Type | Default | Description |
|------|------|---------|-------------|
| `gauge_id` | str | required | USGS NWIS site ID |
| `resolution` | int | `30` | DEM resolution in meters |

Requires `watershed` to be cached.

**Returns**

```json
{
  "twi_mean": 8.42,
  "twi_median": 7.81,
  "twi_std": 2.34,
  "twi_p10": 5.62,
  "twi_p90": 12.1,
  "raster_path": "/path/to/twi.tif"
}
```

---

## Curve Number Tools

### `create_cn_grid`

Creates an NRCS Curve Number grid for the watershed by combining NLCD land cover with Polaris soil properties.

**Parameters**

| Name | Type | Default | Description |
|------|------|---------|-------------|
| `gauge_id` | str | required | USGS NWIS site ID |
| `year` | int | `2019` | NLCD land cover year |
| `resolution` | int | `30` | Grid resolution in meters |
| `create_map` | bool | `true` | Generate visualization map |

Requires `watershed` to be cached (run `delineate_watershed` first).

**Returns**

```json
{
  "data": {
    "cn_mean": 72.4,
    "cn_median": 74.0,
    "cn_std": 12.8,
    "cn_min": 30.0,
    "cn_max": 98.0,
    "low_pct": 15.2,
    "medium_pct": 52.1,
    "high_pct": 32.7,
    "lulc_classes": ["Deciduous Forest", "Mixed Forest", "Hay/Pasture"],
    "soil_group_percentages": {"B": 45.2, "C": 38.1, "D": 16.7},
    "area_km2": 769.0,
    "files_saved": ["/path/to/cn_01031500.tif", "/path/to/cn_01031500.png"]
  },
  "meta": { ... }
}
```

**CN Zone Thresholds**

| Zone | CN Range | Description |
|------|----------|-------------|
| Low | < 60 | High infiltration (forests, deep soils) |
| Medium | 60–80 | Moderate runoff |
| High | > 80 | High runoff (impervious, clay soils) |

---

## Forcing Tools

### `fetch_forcing_data`

Downloads basin-averaged daily climate forcing from [GridMET](https://www.climatologylab.org/gridmet.html).

**Parameters**

| Name | Type | Default | Description |
|------|------|---------|-------------|
| `gauge_id` | str | required | USGS NWIS site ID |
| `start_date` | str | `"2000-01-01"` | Start of forcing period |
| `end_date` | str | `"2010-12-31"` | End of forcing period |

Requires `watershed` to be cached.

**Returns**

```json
{
  "n_days": 3653,
  "variables": ["prcp_mm", "tmax_C", "tmin_C", "pet_mm", "srad_Wm2", "wind_ms"],
  "prcp_mean_mm": 3.47,
  "tmax_mean_C": 12.1,
  "tmin_mean_C": 1.8,
  "pet_mean_mm": 2.15,
  "timeseries": { ... }
}
```

**Variable descriptions**

| Variable | Units | Source |
|----------|-------|--------|
| `prcp_mm` | mm/day | GridMET precipitation |
| `tmax_C` | °C | Maximum air temperature |
| `tmin_C` | °C | Minimum air temperature |
| `pet_mm` | mm/day | Potential evapotranspiration (Hargreaves) |
| `srad_Wm2` | W/m² | Downward surface shortwave radiation |
| `wind_ms` | m/s | Wind speed at 10m |

---

## Modelling Tools

### `train_hydro_model`

Calibrates a rainfall–runoff model for a gauge.

**Parameters**

| Name | Type | Default | Description |
|------|------|---------|-------------|
| `gauge_id` | str | required | USGS NWIS site ID |
| `framework` | str | `"hbv"` | `"hbv"` or `"neuralhydrology"` |
| `model` | str | `"cudalstm"` | NeuralHydrology only: `cudalstm`, `ealstm`, `transformer` |
| `train_start` | str | `"2000-10-01"` | Training period start |
| `train_end` | str | `"2007-09-30"` | Training period end |
| `test_start` | str | `"2007-10-01"` | Test period start |
| `test_end` | str | `"2010-09-30"` | Test period end |
| `epochs` | int | `500` | Epochs per restart (HBV) or total (LSTM) |
| `n_restarts` | int | `3` | HBV only: random restarts (best result kept) |
| `learning_rate` | float | `0.05` | Optimizer learning rate |

**Prerequisites**: `watershed` and `forcing` must be cached in the session.
For CAMELS-671 gauges, CAMELS benchmark streamflow is used automatically; for other gauges, `streamflow` must also be cached via `fetch_streamflow_data`.

**Returns**

```json
{
  "framework": "hbv",
  "model_type": "differentiable",
  "nse": 0.638,
  "kge": 0.644,
  "rmse": 0.41,
  "performance_rating": "satisfactory",
  "epochs_trained": 500,
  "n_restarts": 3,
  "calibrated_params": {
    "TT": -0.82, "CFMAX": 4.2, "FC": 289.0, "LP": 0.71, "BETA": 2.8,
    "K0": 0.31, "K1": 0.08, "K2": 0.004, "UZL": 18.0, "PERC": 1.2,
    "MAXBAS": 2.5, "CET": 0.0
  },
  "model_dir": "/Users/you/.aihydro/models/01031500_hbv/",
  "_note": "NSE=0.638 (satisfactory). Cached in session slot 'model'."
}
```

**Performance thresholds**

| Rating | NSE |
|--------|-----|
| Excellent | ≥ 0.75 |
| Satisfactory | 0.50 – 0.75 |
| Poor | < 0.50 |

### `get_model_results`

Retrieves the cached model results for a gauge without re-running training.

**Parameters**

| Name | Type | Default | Description |
|------|------|---------|-------------|
| `gauge_id` | str | required | USGS NWIS site ID |

Returns the same structure as `train_hydro_model`, or a message if no model has been trained yet.

---

## Session Tools

Session tools manage the **HydroSession** — persistent research state stored at `~/.aihydro/sessions/<gauge_id>.json`.

### `start_session`

Creates or loads a session for a gauge.

```python
start_session(gauge_id="01031500")
```

Returns a summary of computed vs. pending slots.

### `get_session_summary`

Returns the current session state (computed/pending slots, key findings, notes).

```python
get_session_summary(gauge_id="01031500")
```

### `clear_session`

Deletes all cached results for a gauge, starting fresh.

```python
clear_session(gauge_id="01031500")
```

> Use this if you want to re-run tools with different parameters.

### `add_note`

Attaches a researcher annotation to the session.

```python
add_note(gauge_id="01031500", note="2005 peak looks anomalous — check NWIS flags")
```

### `export_session`

Exports session data in various formats.

**Parameters**

| Name | Type | Default | Description |
|------|------|---------|-------------|
| `gauge_id` | str | required | USGS NWIS site ID |
| `format` | str | `"json"` | `"json"`, `"bibtex"`, or `"methods"` |

| Format | Output |
|--------|--------|
| `json` | Full session data as JSON |
| `bibtex` | BibTeX entries for all data sources used |
| `methods` | Ready-to-paste methods paragraph for a paper |

### `sync_research_context`

Manually refreshes the `.clinerules/research.md` file, which gives the AI automatic awareness of the current session state at the start of each conversation.

```python
sync_research_context(gauge_id="01031500")
```

---

## Error Handling

All tools return a consistent error structure when something goes wrong:

```json
{
  "error": true,
  "code": "MISSING_PREREQUISITES",
  "message": "Cannot train model — missing cached data: ['forcing']. Run fetch_forcing_data first.",
  "recovery_hint": "Call fetch_forcing_data('01031500') to resolve."
}
```

Common error codes:

| Code | Cause |
|------|-------|
| `MISSING_PREREQUISITES` | Session is missing a required upstream result |
| `INVALID_GAUGE_ID` | Gauge ID format is wrong or gauge not found in USGS |
| `NO_DATA` | API returned empty data for the requested period |
| `MISSING_DEPENDENCY` | Python package not installed (e.g. `neuralhydrology`) |
| `NETWORK_ERROR` | External API unreachable |
