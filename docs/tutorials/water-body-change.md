---
description: End-to-end AI-Hydro tutorial — delineate a watershed, fetch cloud-free Sentinel-2 imagery, compute NDWI, detect multi-year water-body change with a Mann-Kendall trend, and map the result, all from the chat window.
---

# Tutorial: Water-Body Change from Satellite

This tutorial walks through a complete **remote-sensing** workflow in AI-Hydro: from a point on a map to a multi-year water-extent trend, without writing a line of Earth Engine code. It ties together watershed delineation, the [data-fetch layer](../guide/data-fetch.md), and [spectral indices](../guide/spectral-indices.md).

**Goal:** decide whether the open water in a basin is expanding or shrinking over a decade.

You drive the whole thing in plain language; the annotations show which tools the agent calls.

---

## The scenario

A reservoir-fed basin in semi-arid northwest India, near **lat 28.22, lon 76.77**. We want to know if the water body has grown or shrunk between 2016 and 2024.

---

## Step 1 — Delineate the watershed

```
Delineate the watershed at lat 28.22, lon 76.77.
```

!!! info "What happens"
    The agent calls `delineate_watershed_from_point(lat=28.22, lon=76.77)`. The result is a catchment polygon that becomes the **study geometry** for everything that follows — every fetch and index is clipped to this boundary.

The polygon appears on the [Map panel](../guide/map.md). You now have a session keyed to this basin.

---

## Step 2 — A single cloud-free NDWI snapshot

```
Compute NDWI for this watershed for 2022 using Sentinel-2.
```

!!! info "What happens"
    The agent calls `compute_spectral_index(index_name="NDWI", sensor="sentinel2", start="2022-01-01", end="2022-12-31")`. Behind that one call:

    1. The [data-fetch layer](../guide/data-fetch.md) pulls every Sentinel-2 scene over the basin in 2022.
    2. Clouds are masked, and the stack is reduced to a **per-pixel median** — a clean, gap-free composite.
    3. NDWI = (Green − NIR)/(Green + NIR) is computed on the composite.
    4. The raster is **clipped to the watershed polygon** and pushed to the map.

**Illustrative result:**

```
NDWI computed (Sentinel-2, 2022 median composite)
  mean:      -0.31      (mostly land)
  valid_px:  1,240,553
  threshold: NDWI > 0 ≈ open water
  colormap:  RdBu
```

On the map, the blue (NDWI > 0) pixels trace the reservoir; everything outside the catchment is transparent, so you see the basin shape, not a rectangle.

!!! tip "Crisp shorelines"
    For a sharp shoreline at full sensor resolution, add *"at native resolution"* — the agent sets `native_resolution=True`, which tiles and mosaics the basin at 10–20 m instead of auto-coarsening. Slower, but every pixel is native-res.

---

## Step 3 — The multi-year trend

A single year tells you the current state; to detect *change*, switch to a temporal stack:

```
Now compute yearly NDWI from 2016 to 2024 and tell me if the water body is shrinking.
```

!!! info "What happens"
    The agent calls `compute_spectral_index(index_name="NDWI", frequency="yearly", start="2016-01-01", end="2024-12-31")`. The tool builds **one cloud-free composite per year** and runs a Mann-Kendall trend test on the per-year means.

**Illustrative result:**

```
Yearly NDWI trend (2016–2024)
  period_means:        [-0.28, -0.29, -0.31, -0.30, -0.33, -0.34, -0.31, -0.35, -0.36]
  trend_slope_per_year: -0.009
  p_value:              0.03   (significant at α = 0.05)
```

A negative, significant slope means mean NDWI is falling year on year — the open-water signal is **shrinking**. The agent will interpret this for you ("a statistically significant decline in NDWI consistent with reservoir drawdown over the period").

---

## Step 4 — Record the finding

```
Add a claim that the reservoir water extent declined significantly from 2016 to 2024,
with the NDWI trend as evidence, then export a methods paragraph.
```

!!! info "What happens"
    - `add_claim(...)` records a scoped, evidence-bound scientific claim in the session ledger (confidence, basin, period, and the NDWI run as evidence).
    - `export_session(...)` writes a citable methods paragraph describing the sensor, date range, cloud-masking, compositing, and trend test — ready to drop into a manuscript.

Because every fetch and index carries a [provenance manifest](../guide/sessions.md) (product, source, citation, parameters), the methods text is reproducible and properly attributed.

---

## What you did without writing code

| You asked | The agent ran | The hard part it handled |
|-----------|---------------|--------------------------|
| Delineate at a point | `delineate_watershed_from_point` | NLDI/NHDPlus tracing |
| NDWI for 2022 | `compute_spectral_index` | scene search, cloud masking, median composite, polygon clip |
| Yearly NDWI 2016–2024 | `compute_spectral_index(frequency="yearly")` | per-year composites + Mann-Kendall trend |
| Record + export | `add_claim`, `export_session` | evidence binding + provenance-tracked methods text |

No Earth Engine script, no manual cloud filtering, no GeoTIFF wrangling, and no GEE size-cap crash — the [download layer](../guide/spectral-indices.md#resolution-basin-size) auto-coarsens or tiles as needed.

---

## Try a variation

- **Drought / greening:** swap NDWI for `NDVI` to track vegetation instead of water.
- **Urban growth:** use `NDBI` to follow built-up expansion around the basin.
- **Burn recovery:** use `NBR` before/after a fire season.
- **Different sensor:** add *"using Landsat 9"* for a 30 m, longer-archive alternative.

---

## Related

- [Spectral Indices](../guide/spectral-indices.md) — the index tool in depth
- [Data Fetch](../guide/data-fetch.md) — the layer that supplies the imagery
- [First Full Analysis](../getting-started/first-analysis.md) — the streamflow → HBV-light modelling walkthrough
- [Complete Tool Reference](../tools/reference.md) — every tool used here, with full schemas
