---
description: The AI-Hydro map panel — visualize watershed boundaries, raster grids, and any geospatial file directly inside VS Code with full symbology control.
---

# Map Panel

The AI-Hydro map panel is a side-by-side webview that renders geospatial analysis outputs as interactive layers. Watershed boundaries, TWI grids, gauge locations, and any file you drop on the map appear here automatically — no copy-pasting coordinates into an external tool.

---

## Opening the Map

Click the **Map** button in the AI-Hydro sidebar toolbar, or run `AI-Hydro: Open Map` from the command palette. The panel opens in VS Code's editor column 2 (side-by-side with chat).

On open, all `*.geojson`, `*.kml`, `*.gpx`, `*.topojson`, and `*.shp` files in your workspace are loaded as hidden layers. Toggle them on from the Layers panel.

---

## Loading Files

### Drag-and-drop

Drop any supported file directly onto the map. A blue dashed drop zone appears while dragging. A toast at the bottom of the map reports how many files loaded and any errors.

### + Add Layer button

Click **+ Add Layer…** in the Layers panel (always visible, even when no layers are loaded) to open a native file picker filtered to supported extensions.

### Workspace auto-scan

Files matching `*.geojson`, `*.topojson`, `*.kml`, `*.gpx` in the VS Code workspace are scanned automatically when the map opens and added as hidden layers (📁 badge).

---

## Supported Formats

| Format | Extension(s) | Notes |
|---|---|---|
| GeoJSON | `.geojson`, `.json` | FeatureCollection, Feature, or bare Geometry |
| TopoJSON | `.topojson`, `.json` | Converted to GeoJSON via `topojson-client` |
| KML | `.kml` | Converted via `@tmcw/togeojson` |
| KMZ | `.kmz` | ZIP extracted, then KML converted |
| GPX | `.gpx` | Track points and routes converted to GeoJSON |
| Shapefile | `.zip` | Zipped `.shp + .dbf + .shx + .prj` bundle |
| GeoTIFF | `.tif`, `.tiff` | Single-band; rendered with viridis ramp; must be EPSG:4326 |
| CSV | `.csv` | Auto-detects `lon`/`lat`/`longitude`/`latitude`/`x`/`y` columns |

> **GeoTIFF note**: GeoTIFFs in projected CRSs (anything other than EPSG:4326 / 4269) are rejected with a clear error. Reproject to WGS84 first using QGIS, GDAL (`gdalwarp`), or any online reprojector.

---

## Layers Panel

The panel on the left of the map lists all active layers.

### Per-layer controls

| Control | Action |
|---|---|
| Checkbox | Toggle visibility |
| Colour swatch / 🎨 | Open symbology editor |
| 🔍 | Zoom map to the layer's bounding box |
| ✕ | Remove layer (does not delete the source file) |

### Source badges

Each layer row shows a badge indicating where the layer came from:

| Badge | Source |
|---|---|
| 📁 | Workspace file (auto-scanned) |
| 🐍 | Python tool output (`show_on_map`, `delineate_watershed`, etc.) |
| 📥 | User-loaded file (drag-and-drop or file picker) |
| 📤 | Manually pushed via extension API |

### Panel layout

- **Collapse/expand** — click the `📑` icon; the panel stays visible even when collapsed so you can always add layers
- **Resize** — drag the left edge to any width between 220 and 480 px
- **Panel state persisted** — dock position, width, and section expand state are saved in `localStorage` and restored on next open

---

## Symbology Editor

Click a layer's colour swatch or the 🎨 icon to open the inline symbology editor. Changes apply immediately.

**Vector layers**

| Control | Effect |
|---|---|
| Fill colour | Feature fill (HTML colour picker) |
| Fill opacity | 0 – 1 slider |
| Stroke colour | Feature outline |
| Stroke width | Outline thickness in pixels |

**Raster layers**

| Control | Effect |
|---|---|
| Colormap | viridis · plasma · inferno · magma · cividis · Greens · YlOrRd · RdBu |
| Opacity | 0 – 1 slider |

---

## Layers Added by Analysis Tools

Once you have AI-Hydro's Python backend installed, analysis tools push layers automatically:

| Tool | Layer pushed | Type |
|---|---|---|
| `delineate_watershed` | Watershed boundary polygon + gauge point | Vector |
| `compute_twi` | TWI grid (`viridis_r` colourmap, 70% opacity) | Raster |
| `create_cn_grid` | Curve Number grid (`YlOrRd` colourmap, 70% opacity) | Raster |
| `show_on_map` | Any GeoJSON you pass explicitly | Vector |

The map panel opens automatically when the first layer arrives.

---

## `show_on_map` Tool

Use this to visualise any geometry your analysis produces:

```python
show_on_map(
    geojson=my_geojson_string,   # FeatureCollection / Feature / Geometry
    name="Study Area",
    layer_type="polygon",        # polygon | line | point
    style_preset="watershed",    # watershed | flowlines | gauge | default
    auto_zoom=True,
)
```

**Style presets**

| Preset | Colour | Use for |
|---|---|---|
| `watershed` | Blue (#1a6eb5, 20% opacity) | Catchment polygons |
| `flowlines` | Light blue (#3399ff) | River / stream lines |
| `gauge` | Orange (#e05c00) | Station point markers |
| `default` | Mid-blue (#0066CC) | General purpose |

Per-key overrides:

```python
show_on_map(
    geojson=aoi_geojson,
    name="Custom AOI",
    fill_color="#FF5733",
    stroke_color="#CC3300",
    fill_opacity=0.4,
)
```

---

## Agent map orchestration (symbology)

The agent can **style layers already on the map** without writing duplicate GeoJSON files.

1. Call **`map_get_state`** or **`map_list_layers`** to read `layer_id`, current symbology, and numeric attribute names from `~/.aihydro/map_layer_catalog.json`.
2. Call **`map_update_layer`** with that `layer_id` (fill/stroke colors, visibility, display name).
3. For choropleth / graduated styling, use **`map_apply_symbology`** or pass `graduated_attribute`, `graduated_method`, `graduated_classes`, and `color_ramp` to **`map_update_layer`**.

| MCP tool | Purpose |
|---|---|
| `map_get_state` | Basemap, view, ROI, **layer catalog** (ids, styles, numeric attrs) |
| `map_list_layers` | Layer catalog only |
| `map_update_layer` | In-place style/metadata update by `layer_id` |
| `map_apply_symbology` | Graduated (choropleth) symbology on an existing layer |
| `map_remove_layer` | Remove layer from map |
| `map_set_basemap` | Change basemap |
| `map_fit_layer` / `map_fit_extent` | Zoom viewport |

**Do not** create a second workspace GeoJSON file just to change colors or class breaks on a layer that is already loaded — use `map_update_layer` instead. Use `show_on_map` only when adding **new** geometry.

---

## Basemaps

Click the dropdown in the top-right corner to switch basemap. All 13 options are free — no API token needed.

**Hydrology-focused**

| Basemap | Best for |
|---|---|
| USGS Imagery | Aerial / satellite verification |
| USGS Topo | Watershed context, road networks |
| USGS Shaded Relief | Terrain and slope visualisation |
| Esri Hillshade | High-resolution DEM shading |
| Esri Ocean | Bathymetry + coastal work |

**General purpose**

Carto Voyager (default), Carto Dark, Carto Light, Stadia Terrain, Esri World Topo, Esri Satellite, Humanitarian (HOT).

**Personal use only**

⚠️ OpenStreetMap direct — tile.openstreetmap.org is run by volunteers and disallows embedded-app traffic. Use Carto or HOT basemaps (both OSM-derived) for any deployed workflow.

---

## Map Status Bar

The status bar at the bottom of the map shows:

- **Scale bar** — physical distance per pixel at the current zoom and latitude
- **Coordinates** — latitude/longitude of the pointer position (`45.4981°N, 69.6018°W` format)

---

## How the Python ↔ Map Bridge Works

When a Python tool calls `show_on_map` (or uses `ai_hydro.mcp.map_events` directly), it writes a small JSON event file to `~/.aihydro/map_events/`. The VS Code extension polls that directory every ~600 ms, reads each file, calls `controller.addMapLayer()`, and deletes the file.

This means layers pushed while the map panel was closed will appear the next time you open the panel — they are held in the Controller's in-memory store until VS Code restarts.

---

## Workspace Persistence

The map saves its state to `localStorage` (key `aihydro.map.workspace.v1`) on every change:

- Active basemap
- View state (centre coordinates + zoom level)
- Visible layer IDs
- Layers panel width and dock position

State is restored automatically the next time the panel opens.

---

## Roadmap

- **Draw tools** — sketch a custom AOI polygon and pass it directly to `delineate_watershed`
- **Attribute-driven styling** — colour features by any property (stream order, soil class, CN value) with an auto-legend
- **Multi-band GeoTIFF** — band selector and multi-band RGB composites
- **In-browser reprojection** — accept GeoTIFFs in any CRS and reproject on the fly via `proj4js`
