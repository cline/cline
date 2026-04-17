# Quick Start: Your First Research Session

This walkthrough takes you from a blank workspace to a calibrated HBV model for a real USGS gauge in about 15 minutes.

> **Prerequisites**: AI-Hydro installed and an API key configured. See [installation.md](./installation.md).

---

## The Research Workflow

AI-Hydro follows a natural research pipeline:

```
1. Start session   →  2. Watershed   →  3. Streamflow   →  4. Forcing
                                                                   ↓
                      7. Export      ←  6. Signatures   ←  5. Train model
```

Each step caches its result in a **HydroSession** so nothing is re-fetched if you continue later.

---

## Step 1 — Open the AI-Hydro Panel

Click the AI-Hydro icon in the VS Code Activity Bar (left sidebar). The chat panel opens.

---

## Step 2 — Start a Research Session

Type in the chat:

```
Start a session for USGS gauge 01031500.
```

AI-Hydro will call `start_session("01031500")` and respond with something like:

```
Session started for gauge 01031500.
  Status: 7 pending (watershed, streamflow, signatures, geomorphic, forcing, twi, model)
  Next suggested step: delineate_watershed
```

---

## Step 3 — Delineate the Watershed

```
Delineate the watershed for this gauge.
```

The AI calls `delineate_watershed("01031500")`. This queries USGS NLDI and NHDPlus.
Result in ~10 seconds:

```
Watershed delineated:
  Name:        Piscataquis River near Dover-Foxcroft, ME
  Area:        769.0 km²
  HUC-02:      01 (New England)
  Centroid:    45.18°N, 69.22°W
  Perimeter:   247.3 km
  Saved to session slot: watershed
```

---

## Step 4 — Fetch Forcing Data

```
Fetch 10 years of GridMET forcing data (2000–2010).
```

The AI calls `fetch_forcing_data("01031500", start="2000-01-01", end="2010-12-31")`.
This downloads basin-averaged precipitation, temperature, PET, solar radiation, and wind speed from GridMET.

```
Forcing data fetched:
  Period:    2000-01-01 → 2010-12-31  (3,653 days)
  Variables: prcp_mm, tmax_C, tmin_C, pet_mm, srad_Wm2, wind_ms
  Saved to session slot: forcing
```

---

## Step 5 — Extract Hydrological Signatures

```
Extract hydrological signatures from the USGS streamflow record.
```

The AI calls `fetch_streamflow_data` (if not already done) then `extract_hydrological_signatures`:

```
Hydrological signatures:
  Mean discharge:   1.84 mm/day
  Baseflow index:   0.61
  Runoff ratio:     0.53
  High-flow freq:   12.3 events/year
  Low-flow duration: 41 days/year
  FDC slope (10–90%): 2.14
  Saved to session slot: signatures
```

---

## Step 6 — Train a Hydrological Model

```
Train a differentiable HBV model for this watershed.
```

The AI calls `train_hydro_model("01031500", framework="hbv", epochs=500, n_restarts=3)`.
HBV uses the streamflow already cached in the session. For CAMELS-US gauges the CAMELS benchmark record is used automatically; for other gauges `fetch_streamflow_data` must have been called first.

```
HBV calibration complete (3 restarts × 500 epochs):
  NSE  = 0.638  (satisfactory)
  KGE  = 0.644
  RMSE = 0.41 mm/day

  Calibrated parameters:
    TT=-0.82°C  CFMAX=4.2  FC=289mm  LP=0.71  BETA=2.8
    K0=0.31  K1=0.08  K2=0.004  UZL=18mm  PERC=1.2mm/d

  Model saved to: ~/.aihydro/models/01031500_hbv/
  Cached in session slot: model
```

---

## Step 7 — Check Session Summary

```
Show me a summary of what we've computed so far.
```

```
Session 01031500 — Piscataquis River near Dover-Foxcroft, ME
  Updated: 2026-03-06

  Computed (5): watershed, streamflow, signatures, forcing, model
  Pending  (2): geomorphic, twi

  Key findings:
  - Watershed area:  769.0 km²  (HUC-02: 01)
  - Streamflow:      3,652 days
  - Baseflow index:  0.61
  - Runoff ratio:    0.53
  - HBV differentiable: NSE=0.638, KGE=0.644
```

---

## Step 8 — Export for Your Paper

```
Export a methods paragraph for my paper.
```

The AI calls `export_session("01031500", format="methods")` and returns a ready-to-use paragraph:

```
Watershed delineation for USGS gauge 01031500 (Piscataquis River near
Dover-Foxcroft, ME; 769 km²) was performed using the USGS NLDI and
NHDPlus v2 dataset. Basin-averaged precipitation and temperature forcing
(2000–2010) were extracted from GridMET (Abatzoglou, 2013). Streamflow
Streamflow data were obtained from the CAMELS dataset (Newman et al., 2015; Addor et al., 2017). A differentiable HBV-light model (Seibert, 1997) was
calibrated using the Adam optimiser with cosine annealing (3 restarts,
500 epochs each), achieving NSE = 0.638 and KGE = 0.644 on the test
period (2007–2010). All computations performed with AI-Hydro v1.0.0-alpha
(Galib, 2025).
```

---

## Resuming a Session Later

Session state is persisted to `~/.aihydro/sessions/01031500.json`. When you start a new conversation:

```
Resume my research on gauge 01031500.
```

The AI will call `get_session_summary("01031500")` and immediately know what's been computed, skipping expensive re-downloads.

---

## Common Commands

| What you want | What to say |
|---------------|-------------|
| Start fresh | `Clear the session for gauge XXXXXXXX` |
| Add a note | `Note: the 2005 flood peak looks anomalous` |
| Get BibTeX | `Export BibTeX citations for all data sources used` |
| Full data dump | `Export the full session as JSON` |
| Try geomorphology | `Extract geomorphic parameters for this watershed` |
| Compute TWI | `Compute the Topographic Wetness Index` |

---

## Next Steps

- [Tools Reference](./tools-reference.md) — every tool's parameters and return values
- [Architecture](./architecture.md) — how AI-Hydro works under the hood
- [Contributing](contributing.md) — add your own tools
