# Python API

The `ai_hydro` package can be used directly in Python scripts and notebooks, independently of the VS Code extension or MCP server.

## Installation

```bash
cd AI-Hydro/python
pip install -e .
```

## Core Types

All tools return a consistent `HydroResult` structure.

```python
from ai_hydro.core.types import HydroResult, HydroMeta, ToolError
```

### `HydroResult`

```python
result = tool_function(gauge_id="01031500")

result["data"]              # dict — the actual computed values
result["meta"]              # dict — FAIR provenance
result["meta"]["tool"]      # str — function that produced this
result["meta"]["computed_at"]   # ISO 8601 timestamp
result["meta"]["sources"]   # list of {"name", "url", "citation"}
```

### `ToolError`

Tools raise `ToolError` (or return `{"error": True, "code": ..., "message": ...}`) on failure. Always check for `error` key when calling tools:

```python
result = delineate_watershed("99999999")   # non-existent gauge
if result.get("error"):
    print(result["message"])   # "Gauge 99999999 not found in USGS NWIS"
```

---

## Tools

### Watershed

```python
from ai_hydro.tools.watershed import delineate_watershed

result = delineate_watershed("01031500")
print(result["data"]["area_km2"])    # 769.0
print(result["data"]["gauge_name"]) # "Piscataquis River near Dover-Foxcroft, ME"

# Access the GeoJSON polygon
geojson = result["data"]["geometry"]  # {"type": "Polygon", "coordinates": [...]}
```

### Streamflow

```python
from ai_hydro.tools.streamflow import fetch_streamflow_data

result = fetch_streamflow_data(
    gauge_id="01031500",
    start_date="2000-01-01",
    end_date="2010-12-31"
)
print(result["data"]["n_days"])        # 3652
print(result["data"]["q_mean_mm_day"]) # 1.84

# Time series as date→value dict
ts = result["data"]["timeseries"]
print(ts["2005-04-15"])   # 4.31 mm/day
```

### Hydrological Signatures

```python
from ai_hydro.tools.signatures import extract_hydrological_signatures

# Requires a streamflow result to be passed in
result = extract_hydrological_signatures(
    gauge_id="01031500",
    streamflow_data=streamflow_result["data"]
)
print(result["data"]["baseflow_index"])  # 0.61
print(result["data"]["runoff_ratio"])    # 0.53
print(result["data"]["fdc_slope"])       # 2.14
```

### Forcing Data

```python
from ai_hydro.tools.forcing import fetch_forcing_data

result = fetch_forcing_data(
    gauge_id="01031500",
    watershed_geojson=watershed_result["data"]["geometry"],
    start_date="2000-01-01",
    end_date="2010-12-31"
)

data = result["data"]
print(data["prcp_mean_mm"])   # mean daily precipitation
print(data["tmax_mean_C"])    # mean daily max temperature
# Full time series:
print(data["timeseries"]["prcp_mm"]["2005-04-15"])  # 12.3 mm
```

### Geomorphic Parameters

```python
from ai_hydro.tools.geomorphic import extract_geomorphic_parameters

result = extract_geomorphic_parameters(
    gauge_id="01031500",
    watershed_geojson=watershed_result["data"]["geometry"],
    resolution=30
)
print(result["data"]["elongation_ratio"])   # 0.71
print(result["data"]["hypsometric_integral"]) # 0.44
```

### HBV Model Training

```python
from ai_hydro.tools.modelling import train_hbv_light
from ai_hydro.session import HydroSession
from pathlib import Path

session = HydroSession.load("01031500")   # load cached watershed + forcing
result = train_hbv_light(
    gauge_id="01031500",
    session=session,
    output_dir=Path("./models"),
    train_start="2000-10-01",
    train_end="2007-09-30",
    test_start="2007-10-01",
    test_end="2010-09-30",
    epochs=500,
    n_restarts=3,
    learning_rate=0.05,
)
print(result["nse"])   # 0.638
print(result["kge"])   # 0.644
print(result["calibrated_params"])
```

---

## HydroSession

For workflows involving multiple tools, use `HydroSession` to cache results and avoid redundant API calls.

```python
from ai_hydro.session import HydroSession

# Load existing session or create new
session = HydroSession.load("01031500")
print(session.computed())  # ['watershed', 'forcing', 'model']
print(session.pending())   # ['streamflow', 'signatures', 'geomorphic', 'twi']

# Attach a result
from ai_hydro.tools.watershed import delineate_watershed
session.watershed = delineate_watershed("01031500")
session.save()   # persists to ~/.aihydro/sessions/01031500.json

# Export methods paragraph
print(session.cite_all())   # BibTeX for all computed sources

# Session summary dict
print(session.summary())
# {
#   "gauge_id": "01031500",
#   "computed": ["watershed", "forcing", "model"],
#   "pending": ["streamflow", ...],
#   "notes": []
# }
```

### Adding researcher notes

```python
session.notes.append("2005 peak discharge may be affected by ice jam")
session.save()
```

---

## Example: End-to-End Pipeline

```python
from pathlib import Path
from ai_hydro.session import HydroSession
from ai_hydro.tools.watershed import delineate_watershed
from ai_hydro.tools.forcing import fetch_forcing_data
from ai_hydro.tools.modelling import train_hbv_light

GAUGE = "01031500"

# Load or create session
session = HydroSession.load(GAUGE)

# Step 1: Watershed (skip if already cached)
if session.watershed is None:
    print("Delineating watershed...")
    session.watershed = delineate_watershed(GAUGE)
    session.save()

area_km2 = session.watershed["data"]["area_km2"]
geojson  = session.watershed["data"]["geometry"]
print(f"Area: {area_km2:.1f} km²")

# Step 2: Forcing (skip if already cached)
if session.forcing is None:
    print("Fetching GridMET forcing...")
    session.forcing = fetch_forcing_data(
        GAUGE, watershed_geojson=geojson,
        start_date="2000-01-01", end_date="2010-12-31"
    )
    session.save()

print(f"Forcing: {session.forcing['data']['n_days']} days")

# Step 3: HBV calibration
print("Training HBV model...")
result = train_hbv_light(
    gauge_id=GAUGE,
    session=session,
    output_dir=Path("./models"),
    epochs=500,
    n_restarts=3,
)
print(f"NSE = {result['nse']:.3f}  KGE = {result['kge']:.3f}")

session.model = result
session.save()
```

---

## RAG Knowledge Search

```python
from ai_hydro.rag.engine import RagEngine

rag = RagEngine()
results = rag.search("topographic wetness index computation", n=3)
for r in results:
    print(r["concept"])
    print(r["definition"])
    print()
```

---

## Citing Data Sources

```python
session = HydroSession.load("01031500")
print(session.cite_all())
```

Output (BibTeX):
```bibtex
@misc{usgs_nwis,
  title  = {{USGS National Water Information System}},
  author = {{U.S. Geological Survey}},
  url    = {https://waterdata.usgs.gov/nwis},
  year   = {2024}
}

@misc{gridmet,
  title  = {{GridMET: A Daily High-Spatial Resolution Gridded Meteorological Dataset}},
  author = {Abatzoglou, J.T.},
  year   = {2013},
  journal = {International Journal of Climatology}
}
...
```
