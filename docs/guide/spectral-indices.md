---
description: Compute satellite spectral indices (NDWI, NDVI, NBR, MNDWI, …) over a watershed in AI-Hydro — cloud-masked median composites, native-resolution tiling, polygon clipping, and Mann-Kendall trend detection, all from one tool.
---

# Spectral Indices

AI-Hydro can compute **satellite spectral indices** — NDWI, NDVI, NDBI, NBR, MNDWI, and more — over your study watershed directly from cloud-scale imagery, without you ever writing an Earth Engine script. A single tool, `compute_spectral_index`, fetches the required optical bands, masks clouds, builds a median composite over your date range, computes the index, clips it to the watershed boundary, and pushes the result to the [Map panel](map.md).

```text
"Delineate the watershed at lat 28.22, lon 76.77, then compute NDWI."
```

The agent delineates the catchment, then calls `compute_spectral_index(index_name="NDWI")` — no band math, no GEE code, no manual export.

---

## What an index measures

A spectral index is a normalised ratio of two satellite bands that isolates a surface property:

| Index | Formula (band shorthand) | What it highlights | Typical threshold |
|-------|--------------------------|--------------------|-------------------|
| **NDWI** | (Green − NIR) / (Green + NIR) | Open water bodies | > 0 = water |
| **MNDWI** | (Green − SWIR1) / (Green + SWIR1) | Water, suppresses built-up noise | > 0 = water |
| **NDVI** | (NIR − Red) / (NIR + Red) | Vegetation vigour / green biomass | > 0.3 = vegetation |
| **NDBI** | (SWIR1 − NIR) / (SWIR1 + NIR) | Built-up / impervious surfaces | > 0 = built-up |
| **NBR** | (NIR − SWIR2) / (NIR + SWIR2) | Burn severity (fire scars) | drop after fire |

Call `list_spectral_indices()` for the full registry on your installation — each entry carries its required bands, default colormap, original-paper citation, and a use-case note.

---

## Calling the tool

`compute_spectral_index` is a **hot** tool (its full schema is always in the agent's context), so the agent can call it correctly on the first try. The only required argument is `index_name`.

```python
compute_spectral_index(
    index_name="NDWI",        # required; case-insensitive
    session_id="01646500",    # optional — auto-resolved from chat context
    start="2022-01-01",       # optional — defaults to one year before `end`
    end="2022-03-31",         # optional — defaults to today
    sensor="sentinel2",       # sentinel2 (default) | landsat8 | landsat9 | modis_mod09
    mask_clouds=True,         # sensor-appropriate cloud masking (default True)
    create_map=True,          # push the raster to the Map panel (default True)
    native_resolution=False,  # see "Resolution & basin size" below
)
```

### Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `index_name` | string | — *(required)* | Index to compute. Case-insensitive. e.g. `"NDWI"`, `"ndvi"`, `"NBR"`. |
| `session_id` | string | auto | Research session. Auto-resolved from chat context if omitted. |
| `start` / `end` | string | derived | ISO-8601 date window. `end` defaults to today; `start` to one year earlier. |
| `sensor` | string | `sentinel2` | `sentinel2` (10–20 m), `landsat8`/`landsat9` (30 m), or `modis_mod09`. |
| `frequency` | string \| null | `null` | `null` = one composite; `"monthly"` / `"yearly"` = a temporal stack with trend stats. |
| `mask_clouds` | boolean | `true` | Mask clouds before compositing. Set `false` only for already-clean data. |
| `create_map` | boolean | `true` | Push the index raster to the Map panel. |
| `native_resolution` | boolean | `false` | Force the sensor's native resolution via tiling (see below). |

---

## Cloud-free median compositing

Single satellite scenes are often partly cloud-covered. Rather than return one date's image, the tool:

1. Pulls **every** scene in `[start, end]` from the chosen sensor.
2. Applies sensor-appropriate **cloud masking** (`mask_clouds=True`).
3. Reduces the cloud-masked stack to a **per-pixel median** — clouds in any one scene are out-voted by the clear observations in the others.
4. Computes the index on that clean composite.

The result is a gap-filled, cloud-free index image even over persistently cloudy basins. Widen the date window if a season is too cloudy to composite cleanly.

---

## Resolution & basin size

Earth Engine caps a single synchronous download at roughly 48 MB. AI-Hydro handles this automatically so you never hit a hard failure on a large watershed:

- **Default (`native_resolution=False`)** — the request is **auto-coarsened**: pixel size is increased just enough to keep the single download under the cap. Fast, one round-trip, never crashes. Ideal for overview maps and basin-scale statistics.
- **`native_resolution=True`** — the basin is downloaded as a **grid of full-resolution tiles** (10–20 m for Sentinel-2, 30 m for Landsat) and mosaicked back together. No coarsening, at the cost of several extra round-trips. Use this when you need crisp shoreline or field-level detail.

Either way the output is **clipped to the watershed polygon** — pixels outside the catchment are set to no-data and render transparently on the map, so you see the basin shape, not a rectangular tile.

!!! note "Why the map used to show a rectangle"
    Earth Engine exports a clipped image inside its bounding box with no no-data header, so out-of-polygon pixels look like valid (coloured) data. AI-Hydro now opens every raster with masking enabled and applies an explicit polygon clip, so the overlay matches the catchment boundary exactly.

---

## Trend detection over time

Pass `frequency="monthly"` or `frequency="yearly"` to get a **temporal stack** instead of a single composite. The tool builds one composite per period and returns:

- `time_axis` — the period labels (ISO-8601)
- `period_means` — the index mean for each period
- `trend_slope_per_year` — a Mann-Kendall-compatible linear slope
- `p_value` — the Mann-Kendall significance (if `pymannkendall` is installed)

This is how you detect **reservoir expansion/shrinkage (NDWI), greening or drought (NDVI), urbanisation (NDBI), or post-fire recovery (NBR)** across years from the chat window:

```text
"Compute yearly NDWI for this reservoir from 2016 to 2024 and tell me if it's shrinking."
```

---

## What you get back

`compute_spectral_index` returns a provenance-tracked result with:

- `data` — summary statistics `{mean, median, std, p10, p25, p75, p90, valid_px}`
- `colormap` — the index's default matplotlib colormap
- `citation` — the original paper for the index
- `use_case` and `threshold_hint` — interpretation guidance (e.g. "NDWI > 0 ≈ open water")
- `_files_saved` — the GeoTIFF and PNG written to the workspace
- `_map_layer` — the Map panel layer id
- `next_steps` — suggested follow-on tools

The GeoTIFF is a standard georeferenced raster you can open in QGIS or feed into other AI-Hydro tools; the PNG is the styled overlay shown on the map.

---

## Related

- [Map Panel](map.md) — where the index raster is rendered
- [Complete Tool Reference](../tools/reference.md) — full schema for `compute_spectral_index`, `list_spectral_indices`, and the data-fetch tools
- [Data Fetch](data-fetch.md) — the `aihydro-data` layer that supplies the optical bands
