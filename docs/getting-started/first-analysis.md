---
description: Complete walkthrough of a multi-step AI-Hydro session — watershed delineation to HBV-light calibration — with annotated tool calls and provenance output.
---

# First Full Analysis

A complete walkthrough of a multi-step hydrological research session — watershed delineation → signatures → terrain analysis → HBV-light calibration — with annotation of what the agent is doing at each step.

---

## The Scenario

We'll analyse **USGS gauge 01031500** (Androscoggin River at Rumford, Maine) — a moderately sized New England basin used in CAMELS-US.

---

## Step 1 — Start a Project

```
Start a new project called "New England Basins" and add gauge 01031500 to it.
```

This creates a `ProjectSession` that will organise this gauge alongside others you add later.

```json title="~/.aihydro/projects/new_england_basins/project.json (excerpt)"
{
  "name": "New England Basins",
  "gauge_ids": ["01031500"],
  "created_at": "2026-04-10T09:00:00Z"
}
```

---

## Step 2 — Delineate the Watershed

```
Delineate the watershed for gauge 01031500.
```

!!! info "What happens"
    The agent calls `delineate_watershed("01031500")`, which queries the USGS NLDI API to trace upstream drainage boundaries using NHDPlus data. The result is a polygon geometry with area, perimeter, and bounding box.

**Example result:**
```
Watershed delineated successfully
  Area:      1,247.3 km²
  Perimeter: 198.6 km
  Centroid:  44.58°N, 70.54°W
```

---

## Step 3 — Streamflow and Signatures

```
Fetch 20 years of daily streamflow (2000-2024) and extract hydrological signatures.
```

This runs two tool calls in sequence:

1. `fetch_streamflow_data("01031500", start_date="2000-01-01", end_date="2024-12-31")` → 9,131 daily records from USGS NWIS
2. `extract_hydrological_signatures("01031500")` → 15+ flow statistics

**Key signatures returned:**

| Signature | Value | Interpretation |
|-----------|-------|----------------|
| Baseflow Index (BFI) | 0.52 | Moderate groundwater contribution |
| Runoff ratio | 0.41 | 41% of precipitation becomes runoff |
| Q5 / Q95 ratio | 28.4 | Moderate flow variability |
| Recession constant | 0.97 | Slow recession — storage-rich basin |
| Mean annual discharge | 37.2 m³/s | |

---

## Step 4 — Terrain Analysis

```
Compute the Topographic Wetness Index and extract geomorphic parameters.
```

- `compute_twi("01031500")` → TWI raster from 3DEP 10m DEM
- `extract_geomorphic_parameters("01031500")` → 28 morphometry metrics

**Selected geomorphic results:**

| Parameter | Value |
|-----------|-------|
| Mean elevation | 412 m |
| Mean slope | 8.3° |
| Relief | 890 m |
| Elongation ratio | 0.71 |
| Drainage density | 0.82 km/km² |

---

## Step 5 — Model Calibration

```
Fetch GridMET forcing and calibrate a differentiable HBV-light model.
```

1. `fetch_forcing_data` — basin-averaged daily GridMET (prcp, tmax, tmin, PET, srad, wind, 2000–2024)
2. `train_hydro_model("01031500", framework="hbv")` — differentiable HBV-light in PyTorch

**Calibration results:**

| Metric | Training | Validation |
|--------|----------|-----------|
| NSE    | 0.84     | 0.79      |
| KGE    | 0.81     | 0.76      |
| RMSE   | 14.2 m³/s | 16.8 m³/s |

---

## Step 6 — Export

```
Export a methods paragraph for my manuscript and save a journal entry
noting that HBV performed well on this basin.
```

The agent:
- Calls `export_session` → writes a citable methods paragraph to disk
- Calls `add_journal_entry` → logs the observation to the project journal with timestamp

---

## What's Persisted

After this session, the following files exist on disk:

```
~/.aihydro/
├── sessions/
│   └── 01031500.json          ← full session state (all results)
├── projects/
│   └── new_england_basins/
│       ├── project.json       ← project metadata + journal
│       └── exports/
│           └── 01031500_methods.txt
└── researcher.json            ← your researcher profile (updated)
```

In your next conversation, `get_session_summary("01031500")` gives the agent instant context on everything that was computed — no re-running, no re-downloading.

---

## Next Steps

- Add more gauges: `"Add gauge 01013500 to the New England Basins project"`
- Search across basins: `"Which gauges in my project have BFI > 0.5?"`
- Compare: `"Compare the HBV performance across all gauges in the project"`
