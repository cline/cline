---
description: Draw cross-sectional profile lines, extract raster values, compute geomorphic metrics, overlay multiple layers, and send results to the AI agent.
---

# Transect Profiles

Click the **📈** icon in the Tool Ribbon to open the Transects panel. Transects let you draw a path across the map, instantly extract elevation or any raster value along that line, visualize the profile as an interactive chart, compute geomorphic metrics, and dispatch the data to the AI agent — individually or in batch.

---

## Drawing a Transect

1. Click **+ Draw Profile** in the panel header
2. Click the map to set each waypoint along your path
3. **Double-click** to finish — the transect is saved immediately with a colour and auto-generated name

Transects are saved persistently (browser `localStorage`) and survive panel close and VS Code restart.

---

## The Transect Card

Each transect appears as a compact card showing its colour swatch, name, waypoint count, and quick-action buttons. Click **▼** to expand the full detail view.

### Quick actions (collapsed card)

| Button | Action |
|---|---|
| **📍 Fly to** | Zoom the map to the transect's start point |
| **✨ Ask Agent** | Send the profile data to the AI agent |
| **🗑️ Delete** | Remove the transect |

### Expanded card — profile chart

When expanded, the panel samples 200 evenly-spaced points along the transect using Haversine interpolation and plots a **dynamic profile chart** (distance in km on the X-axis, raster value on the Y-axis).

The chart is linked to the map — **hover over the chart** to drop a live marker on the map at that geographic coordinate, so you can see exactly which terrain feature corresponds to each part of the profile.

---

## Raster Sampling

The panel samples the **analysis-ready raster** layer that is visible and on top of the render order. The profile updates automatically whenever you change layer visibility or reload a raster.

> **Only local GeoTIFFs with raw pixel values loaded are sampled.** Python-pushed PNGs and GEE tiles are display-only and cannot be profiled. If the chart is blank, open the Layers panel → click the raster → **Load raster values**.

### Sample-layer picker

If you want to pin a transect to a specific raster (not the topmost visible one), use the **Sample layer** dropdown in the expanded card. Choose any currently visible analysis-ready raster. The selected layer is stored with the transect metadata so re-opening the card re-samples the same layer.

---

## Overlay Mode (Multi-Layer Chart)

Toggle **Overlay** in the expanded card header to switch from single-layer to **multi-layer mode**. In overlay mode the panel sweeps all visible analysis-ready rasters in a single pass and plots each as a separate series on one shared chart.

- Each series is coloured by the layer's colormap or display colour
- Hover over a series line to dim the others and highlight that layer
- The shared X-axis is distance in km; each Y-axis series uses the layer's own value range
- The layer legend below the chart shows which colour corresponds to which raster

Overlay mode is useful for comparing TWI against Curve Number along the same transect, or for checking how two DEM products differ in a valley cross-section.

---

## Geomorphic Metrics

Below the profile chart the panel automatically computes four geomorphic metrics from the profile data:

| Metric | Description |
|---|---|
| **Relief** | max − min value along the transect (same units as the raster) |
| **Hypsometric integral** | (mean − min) / (max − min) — shape descriptor: >0.6 monadnock, 0.4–0.6 mature, <0.4 peneplain |
| **Thalweg distance** | Distance along the transect to the minimum value (km from start) |
| **Mean gradient** | Mean of |Δvalue / Δdist| — average rate of change per km |

These are shown as small chip badges. They update instantly when you change the sample layer or toggle overlay mode.

---

## Asking the Agent

Click **✨ Ask Agent** on any card. The agent receives:

- The transect's waypoint coordinates
- The full profile (distance, value at each of the 200 sample points)
- The name and units of the sampled raster layer
- The computed geomorphic metrics
- The list of currently visible layers

Leave the **AI Prompt** field blank to use the smart default, or type a specific instruction such as *"Identify potential landslide zones along this slope profile"* or *"Describe the valley morphology at each inflection point"*.

---

## Collections

Organize transects into named **Collections** — one per field area, sub-basin, or analysis theme.

| Action | How |
|---|---|
| **+ Collection** | Button above the tabs row |
| **Assign transect** | Expand the card, click the collection name |
| **Switch** | Click the tab |
| **All** tab | Shows every transect regardless of collection |

---

## Batch Analysis

While viewing any collection tab, click **✨ Batch Ask Agent**. The panel computes a live profile summary for each transect in the collection and sends a CSV table to the agent with:

- Transect ID, name, length (km)
- Profile statistics: min · max · mean value, sample count
- Raster layer name

The optional **Batch instruction** field lets you add a custom directive (e.g. *"Flag any transect with relief > 200 m as a high-priority erosion site"*). Leave it blank for a general comparative analysis.

---

## Export

Click **⬇ Export ▾** to download the current collection (or all transects on the All tab):

| Format | Contents |
|---|---|
| **📊 CSV** | One row per transect: geometry stats, profile stats, metadata |
| **🌐 GeoJSON** | LineString FeatureCollection with all metadata and profile stats as properties |
| **🌍 KML** | LineString placemarks — ready for Google Earth or field GPS |
| **📝 Markdown report** | Human-readable report with per-transect stats and notes |
| **📍 Profile points CSV** | Full-resolution point export: one row per sample point with `transect_id`, `dist_km`, `lon`, `lat`, `value` — 200 points × N transects |

> **Profile points CSV** is the format to use for downstream statistical analysis in Python, R, or Excel — it contains the complete sampled geometry, not just summary statistics.

---

## Map Rendering

Saved transects are rendered as coloured lines on the map even when the panel is collapsed. **Click any transect line** on the map to jump to its card and expand the detail view automatically.

When you hover over the profile chart, a white dot marker appears on the map at the corresponding geographic location.

---

## Search

Use the search bar at the top of the panel to filter transects by name, tag, status, or notes. The filter applies to the current tab (collection or All).

---

## Tips & Workflows

- **DEM cross-section**: Load a 3DEP GeoTIFF, draw a transect perpendicular to a valley, expand — the chart shows the valley floor and side slopes immediately
- **TWI vs Curve Number comparison**: Load both rasters, toggle Overlay on any transect, compare the two curves along the same path
- **Hypsometric integral interpretation**: HI > 0.6 → monadnock stage (active uplift or resistant rock); HI < 0.4 → peneplain (old erosional surface)
- **Thalweg finder**: The thalweg distance chip tells you how far along the transect the minimum elevation occurs — useful for confirming whether a stream channel is where you expect it
- **Profile points in Python**: Export as Profile points CSV, load with `pd.read_csv()`, and use `scipy.signal.find_peaks` to locate knickpoints programmatically
