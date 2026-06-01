---
description: Manage, style, and inspect every layer type on the AI-Hydro map — rasters, vectors, GEE tiles, and more.
---

# Layers & Symbology

The **Layers panel** (📑) is the central control surface for everything on the map canvas. Open it from the Tool Ribbon on the right edge.

---

## Loading Layers

| Method | How |
|---|---|
| **Drag-and-drop** | Drop any supported file directly onto the map canvas |
| **+ Add Layer…** | File picker in the Layers panel — filtered to supported formats |
| **🔗 URL** | Load from a remote GeoJSON, tile endpoint, or direct file link |
| **Explorer right-click** | Right-click a geospatial file → *Add to AI-Hydro Map* |
| **Python tools** | Analysis tools push layers automatically over the gRPC stream |

### Supported Formats

| Format | Extensions | Notes |
|---|---|---|
| GeoJSON | `.geojson`, `.json` | FeatureCollection, Feature, or bare Geometry |
| TopoJSON | `.topojson`, `.json` | Converted via `topojson-client` |
| KML | `.kml` | Placemarks, paths, and polygons |
| KMZ | `.kmz` | ZIP extracted, inner KML parsed |
| GPX | `.gpx` | Track points and routes |
| Shapefile | `.zip` | Must contain `.shp + .dbf + .shx`; `.prj` recommended |
| GeoTIFF | `.tif`, `.tiff` | Single-band raster; see [GeoTIFF](#geotiff-support) below |
| CSV | `.csv` | Auto-detects `lon`/`lat`/`longitude`/`latitude`/`x`/`y` columns |

---

## Layer Types & Icons

| Icon | Layer type |
|---|---|
| ● | Point |
| 〰 | Line |
| ⬡ | Polygon |
| ▦ | Raster (local GeoTIFF) |
| ◉ | GEE tile layer |
| ◈ | Other / unknown |

---

## Source Badges

| Badge | Source |
|---|---|
| 📁 | Workspace file (auto-scanned on open) |
| 🐍 | Python tool output |
| 📥 | User-loaded (drag-and-drop / file picker) |
| 🛰 | Google Earth Engine layer |
| 📤 | Pushed via extension API |

---

## Performance & Large Files

AI-Hydro is optimised to stay responsive when many or large layers are loaded simultaneously.

### What happens under the hood

| Situation | How it's handled |
|---|---|
| Opening a large GeoJSON or CSV | Parsed in a **Web Worker** off the main thread — the map stays interactive during load |
| Pan / zoom with many layers | Geometry is tessellated once and reused; deck.gl skips GPU re-upload when nothing changed |
| Opacity or style change | Color accessors update without rebuilding geometry |
| File with > 2 million coordinates | Worker applies **automatic grid-snap simplification** before adding the layer |

### The "simplified" badge

If a loaded file contains more than 2 million coordinates (e.g., a high-density river network or continental-scale polygon set), the layer is automatically simplified before display:

- Coordinates are snapped to a grid sized to ~1/10 000 of the data extent (minimum 1 × 10⁻⁵°, roughly 1 m at the equator).
- Adjacent duplicate vertices are removed. **Point features are never touched.**
- A blue **simplified** badge appears in the layer row. Hover over it to see the original and reduced coordinate counts.

The simplified version is display-only — the source file on disk is not modified.

> **When does this matter?** At typical screen resolutions, sub-metre coordinate differences are sub-pixel. Simplification has no visible effect on the map but can reduce a 5 M-coordinate watershed delineation to < 500 K, cutting GPU tessellation time by 10×.

---

## Status Pills

Each layer row shows a coloured pill describing its analysis readiness:

| Status | Meaning |
|---|---|
| **Analysis-ready raster** | GeoTIFF with raw pixel values loaded — colormap editable, value probing active, profile charts work |
| **Visual preview raster** | Pre-rendered PNG from Python — display only, no per-pixel analysis |
| **Remote raster** | GEE tile or URL-loaded image |
| **Reference vector** | MERIT / WBD boundary layer |
| **Analysis output** | Vector produced by a Python tool |

A **stale** badge appears when the source file has changed since the layer was loaded. Click ⟳ to reload.

> **Profile charts and cursor readings require an analysis-ready raster.** If the value probe shows nothing, open Symbology and click **Load raster values**.

---

## Per-Layer Controls

| Control | Action |
|---|---|
| Checkbox | Toggle visibility |
| Colour swatch | Open symbology editor |
| 🔍 | Zoom map to layer bounding box |
| 📋 | Open provenance record |
| ↗ | Open source file in VS Code editor |
| ⟳ | Reload layer from source file |
| 🎨 | Symbology editor |
| 🔘 / 🧩 | Toggle point clustering (point layers only) |
| 📊 | View attribute table (vector layers) |
| 📁 | Save to workspace vectors folder |
| 💾 | Export layer as GeoJSON download |
| ▾ / ▴ | Show / hide full metadata |
| ↑ / ↓ | Move layer up / down in render order |
| ⠿ | Drag handle for reordering |
| ✕ | Remove layer (source file not deleted) |

### Renaming

Double-click a layer name to rename it inline. The new name is saved to `display_name` metadata and reflected everywhere — including the live legend and Map Plate Composer.

### Opacity

Each visible layer shows an opacity slider (0–100%) below the name row. Rasters blend against the basemap; vector layers multiply against stroke and fill alpha.

---

## Global Controls

| Control | Action |
|---|---|
| **Show all / Hide all** | Toggle all layers at once |
| **+ Add Layer…** | Open file picker |
| **🔗 URL** | Load from URL |
| **💾 Save scene** | Persist full layer stack, styles, view, and source references |
| **📂 Open scene** | Restore a previously saved map scene |
| **ⓘ** | Toggle metadata detail rows for all layers |
| **Clear all layers** | Remove all layers (with confirmation) |

---

## Layer Reordering

Drag a layer row using its ⠿ gripper, or use ↑/↓ buttons, to change render order. **Layers lower in the list render on top.** This controls which raster is sampled by transect profiles and the cursor value probe.

---

## Point Clustering

For dense point networks (USGS gauges, precipitation stations), enable **Cluster** in the layer row. Points within the same grid cell at low zoom are aggregated into a single marker sized by count.

---

## Symbology Editor

Click a layer's colour swatch or the 🎨 icon to open the inline editor.

### Vector Layers

| Control | Effect |
|---|---|
| Fill colour | Feature fill (HTML colour picker) |
| Fill opacity | 0–1 slider |
| Stroke colour | Feature outline colour |
| Stroke width | Outline thickness (pixels) |

### Raster Layers

| Control | Effect |
|---|---|
| Status badge | Shows analysis-ready vs visual preview |
| **Value histogram** | 40-bin SVG histogram from raw pixel data; bars coloured with the active colormap |
| Colormap | viridis · viridis_r · plasma · magma · cividis · Blues · YlOrRd · RdYlGn |
| Opacity | 0–1 slider |
| **Load raster values** | Hydrates raw pixel data (unlocks colormap editing and per-pixel analysis) |

The histogram is only shown for analysis-ready rasters. Switching colormaps instantly recolors the histogram bars to match.

---

## Graduated (Choropleth) Symbology

For vector layers, click **By Attribute** to open the graduated symbology editor:

1. Select a **numeric attribute** from the layer's feature properties
2. Choose a **classification method**: Natural Breaks, Equal Interval, or Quantile
3. Pick a **colour ramp**: viridis, YlOrRd, Blues, RdYlGn, or custom stops
4. Set the **number of classes** (2–7)
5. Click **Apply** — breaks and colours are stored in layer metadata and re-applied on every render

The map legend updates automatically to show the colour ramp and class boundaries.

---

## GeoTIFF Support

GeoTIFFs are decoded with **geotiff.js** entirely in-browser — no server round-trip.

### Supported CRS

| EPSG | Name |
|---|---|
| 4326, 4269, 4152 | WGS84 / NAD83 geographic — rendered directly |
| 3857, 900913 | Web Mercator — pixel-warped to WGS84 |
| 5070, 102003 | CONUS Albers (NLCD, POLARIS, 3DEP) — pixel-warped |
| 26901–26960 | NAD83 UTM zones 1–60 — pixel-warped |
| 32601–32660 | WGS84 UTM zones North — pixel-warped |
| 32701–32760 | WGS84 UTM zones South — pixel-warped |
| 26701–26760 | NAD27 UTM — pixel-warped |
| 25801–25860 | ETRS89 UTM — pixel-warped |

Warping uses bilinear interpolation; output is capped at 512 px on the long axis. Unsupported CRSs return a clear error — reproject to EPSG:4326 first using `gdalwarp` or QGIS.

---

## Layers from Python Analysis Tools

| Tool | Layer pushed | Type |
|---|---|---|
| `delineate_watershed` | Watershed boundary polygon + outlet point | Vector |
| `compute_twi` | TWI grid (viridis_r, 70% opacity) | Raster |
| `create_cn_grid` | Curve Number grid (YlOrRd, 70% opacity) | Raster |
| `show_on_map` | Any GeoJSON you pass | Vector |
| `gee.preview_layer` | Google Earth Engine tile mosaic | GEE tile |
| `merit_add_map_layers` | MERIT river network for a basin | Vector |
| `wbd_add_map_layers` | WBD HUC boundaries | Vector |
