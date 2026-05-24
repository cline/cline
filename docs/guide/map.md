---
description: The AI-Hydro map panel — visualize watershed boundaries, raster grids, GEE tiles, and any geospatial file directly inside VS Code with full symbology, measurement, and agent-integration.
---

# Map Panel

The AI-Hydro map panel renders geospatial analysis outputs as interactive layers inside VS Code — watershed boundaries, TWI grids, gauge networks, GEE tiles, and any file you drop on the canvas appear here automatically. No copy-pasting coordinates into an external tool; no Mapbox token; no QGIS dependency.

The renderer is built on **deck.gl** (GPU-accelerated) and talks to the extension host over **gRPC streaming** so the map updates in real time as Python tools push layers.

---

## Opening the Map

Click the **Map** icon in the AI-Hydro activity bar, or run `AI-Hydro: Open Map` from the command palette (`Cmd+Shift+P`). The panel opens in editor column 2, side-by-side with the chat.

---

## Loading Files

### Drag-and-drop

Drop any supported file directly onto the map canvas. A blue dashed drop zone appears while dragging. A toast at the bottom reports success or error and auto-dismisses after 4 seconds.

### + Add Layer (file picker)

Click **+ Add Layer…** in the Layers panel to open a native file picker filtered to all supported extensions.

### From VS Code Explorer (right-click)

Right-click a geospatial file in the Explorer panel and choose **Add to AI-Hydro Map**. The extension reads the file bytes and posts them directly to the webview without writing a temp copy.

### Python tools (automatic)

Analysis tools push layers directly when they produce geometry — see [Layers from Analysis Tools](#layers-from-analysis-tools).

---

## Supported File Formats

| Format | Extensions | Notes |
|---|---|---|
| GeoJSON | `.geojson`, `.json` | FeatureCollection, Feature, or bare Geometry |
| TopoJSON | `.topojson`, `.json` | Converted via `topojson-client` |
| KML | `.kml` | Placemarks, paths, and polygons via `@tmcw/togeojson` |
| KMZ | `.kmz` | ZIP extracted, inner KML parsed |
| GPX | `.gpx` | Track points and routes → GeoJSON |
| Shapefile | `.zip` | Zip must contain `.shp + .dbf + .shx`; `.prj` recommended |
| GeoTIFF | `.tif`, `.tiff` | Single-band raster; see [GeoTIFF support](#geotiff-support) |
| CSV | `.csv` | Auto-detects `lon`/`lat`/`longitude`/`latitude`/`x`/`y` columns |

### GeoTIFF Support

GeoTIFFs are read with **geotiff.js** entirely in-browser. Supported CRSs:

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

Warping: bilinear interpolation, output capped at 512 px on the long axis. Unsupported CRSs return a clear error; reproject to EPSG:4326 first using QGIS or `gdalwarp`.

Colormaps for GeoTIFFs default to **viridis** and can be changed in the Layers panel without reloading the file.

---

## Tool Ribbon

The right-edge ribbon provides quick access to all map tools. Click an icon to open its panel; click again to collapse. Only one panel is open at a time.

| Icon | Tool | Description |
|---|---|---|
| 🗺️ | Basemap | Switch the base tile layer |
| 📑 | Layers | Layer list, symbology, reorder, export |
| 〰 | Hydrography | Load MERIT rivers, WBD boundaries |
| 🔍 | Search | Geocode a place and pin it on the map |
| 📐 | Measure | Distance or area measurement |
| ✏️ | Draw | Sketch polygons, lines, or points |
| 📤 | Export | Save map canvas as PNG |
| ⛶ | Fit extent | Zoom to all visible layers |

---

## Basemaps

All basemaps are free — no API token required.

### Hydrology-focused

| Basemap | Best for |
|---|---|
| USGS Topo (default) | Watershed context, roads, terrain names |
| USGS Imagery | Aerial / satellite verification |
| USGS Shaded Relief | Terrain hillshading |
| Esri Hillshade | High-resolution DEM shading |
| Esri Ocean | Bathymetry and coastal work |

### General purpose

Carto Voyager, Carto Dark, Carto Light, Stadia Terrain, Esri World Topo, Esri Satellite, Humanitarian (HOT).

> **OpenStreetMap direct**: tile.openstreetmap.org is run by volunteers and disallows embedded-app traffic. Use Carto or HOT basemaps for any deployed workflow — both are OSM-derived.

---

## Layers Panel

The Layers panel lists all active layers and provides per-layer controls.

### Layer type icons

| Icon | Layer type |
|---|---|
| ● | Point |
| 〰 | Line |
| ⬡ | Polygon |
| ▦ | Raster (local GeoTIFF) |
| ◉ | GEE tile layer |
| ◈ | Other / unknown |

### Source badges

| Badge | Source |
|---|---|
| 📁 | Workspace file (auto-scanned on open) |
| 🐍 | Python tool output |
| 📥 | User-loaded (drag-and-drop / file picker) |
| 📤 | Pushed via extension API |

### Per-layer controls

| Control | Action |
|---|---|
| Checkbox | Toggle visibility |
| Colour swatch | Open symbology editor |
| 🔍 | Zoom map to layer bounding box |
| 📊 | View attribute table (feature properties) |
| 💾 | Export layer as GeoJSON |
| ⠿ | Drag handle for reordering |
| ✕ | Remove layer (source file not deleted) |

### Global controls

- **Show all / Hide all** — toggle all layers at once
- **+ Add Layer…** — open file picker
- **ⓘ** — toggle metadata detail rows for all layers

### Layer reordering

Drag a layer row using its ⠿ gripper to change render order. Layers at the bottom of the list render on top of all others.

### Per-layer opacity

Each layer has an opacity slider (0–100%). For raster layers this blends against the basemap. For vector layers it multiplies against stroke and fill alpha.

### Point clustering

For dense point networks (USGS gauges, precipitation stations), enable **Cluster** in the layer row. Points within the same grid cell at zoom < 8 are aggregated into a single marker sized by count. Clustering is computed per-zoom-level and cached per frame.

---

## Symbology Editor

Click a layer's colour swatch or the 🎨 icon to open the inline editor. Changes apply live.

### Vector layers

| Control | Effect |
|---|---|
| Fill colour | Feature fill (HTML colour picker) |
| Fill opacity | 0–1 slider |
| Stroke colour | Feature outline colour |
| Stroke width | Outline thickness (pixels) |

### Raster / GEE tile layers

| Control | Effect |
|---|---|
| Colormap | viridis · viridis_r · plasma · magma · cividis · Blues · YlOrRd · RdYlGn · chirps |
| Opacity | 0–1 slider |

### Graduated (choropleth) symbology

For vector layers, click **Graduated…** to open the graduated symbology editor:

1. Select a **numeric attribute** from the layer's feature properties
2. Choose a **classification method**: Natural Breaks, Equal Interval, or Quantile
3. Pick a **colour ramp**: viridis, YlOrRd, Blues, RdYlGn, or custom stops
4. Set the **number of classes** (2–7)
5. Click **Apply** — breaks and colours are stored in layer metadata and re-applied on every render

The map legend updates automatically to show the colour ramp and class boundaries.

---

## Measure Tool

Click the 📐 icon in the Tool Ribbon to activate measurement.

| Mode | How to use |
|---|---|
| **Distance** | Click two or more points; each segment shows its length in km/m; total length is shown in the toolbar |
| **Area** | Click three or more points to close a polygon; area is shown in km² or ha |

- Segment labels appear on the map at each midpoint (distance mode)
- Press **ESC** or click 📐 again to cancel
- Measurement geometry is rendered as an orange overlay layer that disappears when the tool closes

Distance uses the Haversine formula (great-circle distance on a sphere). Area uses the 2D planar approximation from the projected Mercator coordinates — accurate to within ~1% for basins up to ~100,000 km².

---

## Vector Draw Tool

Click the ✏️ icon in the Tool Ribbon to draw geometry on the map.

| Mode | Geometry type |
|---|---|
| Polygon | Click vertices; double-click to close |
| Line | Click vertices; double-click to finish |
| Point | Single click to place |

After drawing:

1. A green overlay shows the draft geometry
2. A **Save / Discard / Export** panel appears
3. **Save** — prompts for a name, saves as `roi/<name>.geojson` in your workspace root, registers as the active ROI
4. **Export** — downloads the GeoJSON directly to your Downloads folder
5. **Discard** — clears the draft

The saved ROI is immediately available to all MCP tools via `sessionId='map'` — e.g. `delineate_watershed_from_point`, `extract_hydrological_signatures`.

---

## Feature Inspector

Click anywhere on the map to open the Feature Inspector panel.

### What it shows

- **Coordinates** — WGS84 lat/lon of the click point
- **Vector features** — properties of every visible vector feature at that point (deck.gl pick + point-in-polygon fallback for workspace layers)
- **Raster value** — pixel value of the topmost visible raster at that point (requires local GeoTIFF; not available for GEE tiles)

### Actions in the Feature Inspector

| Button | Action |
|---|---|
| **Quick Delineate** | Runs `delineatePoint` command immediately — no chat opened; result appears on map within seconds |
| **Delineate (agent)** | Opens the chat with a pre-filled delineation prompt; the agent calls MCP tools |
| **Ask AI** | Opens the chat with a prompt describing the clicked location, visible layers, and feature properties |

**Quick Delineate details:**

- Inside CONUS: uses NLDI snap + NWM fallback (fast, ~5 seconds)
- Outside CONUS: requires MERIT river vectors on the map — loads them first via Hydrography → Load rivers if missing
- Adds watershed polygon + pour-point marker to the map and auto-fits bounds
- Reports area_km² and method_used in a status chip below the panel

---

## Hydrography Panel

Click the 〰 icon in the Tool Ribbon to open the Hydrography panel. This provides one-click loading of global and US-specific hydrology reference layers.

| Button | Loads |
|---|---|
| **MERIT rivers (region)** | MERIT-Hydro river network for the current map view extent |
| **MERIT rivers (basin)** | MERIT-Hydro rivers for the active ROI basin |
| **WBD / HUC boundaries** | USGS Watershed Boundary Dataset at HUC 2/4/6/8 |
| **HUC at point** | Delineates which HUC polygon contains the current click point |
| **Gauges in view** | USGS stream gauges for the current map extent |
| **Dams in view** | NID dams for the current map extent |

All layers arrive via the MCP server and are pushed through the gRPC layer subscription — they appear on the map without a page reload.

---

## Location Search

Click the 🔍 icon in the Tool Ribbon to open the search bar.

- Type a place name, address, or geographic feature
- Results appear as you type (Nominatim geocoding via OpenStreetMap)
- Click a result to fly to it and drop a pulsing pin marker
- Click **✕** on the pin card to clear it

The search uses the current map viewport as a geographic bias so results near the basin of interest rank higher.

---

## Map Export

Click the 📤 icon in the Tool Ribbon to export the current map canvas as a PNG. The deck.gl canvas is captured at its current resolution and downloaded with a timestamp filename (`ai-hydro-map-YYYY-MM-DDTHH-MM-SS.png`).

> **Tile completeness**: the export captures whatever tiles are currently loaded. Zoom in before exporting for higher-detail imagery.

---

## Map Status Bar

The bar at the bottom of the map shows:

| Element | Detail |
|---|---|
| **Scale bar** | Physical distance per pixel at current zoom and latitude |
| **Coordinates** | Cursor position — click to cycle between decimal (45.4981°N), DMS (45°29'53.2"N), and UTM |
| **Bearing indicator** | Compass needle; click to reset north |
| **Zoom controls** | +/– buttons |
| **Attribution** | Basemap source links (required by tile licenses) |

---

## Layers from Analysis Tools

Once the AI-Hydro Python backend is installed and configured, analysis tools push layers automatically:

| Tool | Layer pushed | Type |
|---|---|---|
| `delineate_watershed` | Watershed boundary polygon + outlet point | Vector |
| `compute_twi` | TWI grid (viridis_r, 70% opacity) | Raster |
| `create_cn_grid` | Curve Number grid (YlOrRd, 70% opacity) | Raster |
| `show_on_map` | Any GeoJSON you pass | Vector |
| `gee.preview_layer` | Google Earth Engine tile mosaic | GEE tile |
| `merit_add_map_layers` | MERIT river network for a basin | Vector |
| `wbd_add_map_layers` | WBD HUC boundaries | Vector |

---

## `show_on_map` Tool

Push any geometry from your Python analysis session directly to the map:

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

| Preset | Fill colour | Stroke | Use for |
|---|---|---|---|
| `watershed` | `#1a6eb5` (20% opacity) | `#003399` | Catchment polygons |
| `flowlines` | transparent | `#3399ff` | River / stream lines |
| `gauge` | `#e05c00` | `#993300` | Station point markers |
| `default` | `#0066CC` | `#003399` | General purpose |

Per-key overrides:

```python
show_on_map(
    geojson=aoi_geojson,
    name="Custom AOI",
    fill_color="#FF5733",
    stroke_color="#CC3300",
    fill_opacity=0.4,
    stroke_width=2,
)
```

---

## Agent Map Orchestration

The agent can read map state and update layers without creating duplicate geometry files.

### Reading map state

```
map_get_state      → basemap, view center/zoom, active ROI, full layer catalog
map_list_layers    → layer catalog only (ids, names, types, styles, numeric attributes)
```

### Updating existing layers

```
map_update_layer(layer_id, fill_color, stroke_color, opacity, display_name, visible)
map_apply_symbology(layer_id, graduated_attribute, method, classes, color_ramp)
map_remove_layer(layer_id)
```

### Viewport control

```
map_fit_extent          → fit all visible layers
map_fit_layer(layer_id) → fit a specific layer
map_set_basemap(id)     → change basemap
```

> **Do not** write a second GeoJSON file just to re-style a layer that is already on the map. Use `map_update_layer` for style changes; `show_on_map` only when adding **new** geometry.

---

## Workspace Persistence

Map state is saved to `localStorage` key `aihydro.map.workspace.v1` on every change and restored automatically on next open:

- Selected basemap
- View state (longitude, latitude, zoom, pitch, bearing)
- Visible layer IDs
- Per-layer opacity overrides
- Clustering-enabled layer IDs
- Ribbon panel dimensions (width × height)

---

## Keyboard Shortcuts

| Key | Action |
|---|---|
| `Esc` | Cancel active draw / measure / close search or export panel |
| `+` / `-` | Zoom in / out (status bar buttons) |
| Click scale | Cycle coordinate display format (decimal → DMS → UTM) |

---

## How the Python ↔ Map Bridge Works

When a Python tool calls `show_on_map` or any map-aware MCP tool, the flow is:

1. MCP tool calls `ai_hydro.mcp.map_events.push_layer(layer)` on the server
2. The server writes a small JSON event to `~/.aihydro/map_events/`
3. The VS Code extension file-watcher picks it up (~600 ms polling), calls `controller.addMapLayer()`, and deletes the file
4. The controller forwards the layer over the gRPC `MapService.subscribeToMapLayers` stream
5. `MapContext` receives the stream event and updates React state — deck.gl re-renders

For GEE tile layers, the Python tool computes the tile URL template using `geemap` and passes it in the `metadata.gee_tile_url_template` field. The map renders tiles via a deck.gl `TileLayer` fetching each tile directly from the GEE Maps API (requires authenticated GEE session on the Python side).

Layers pushed while the map was closed are queued in the controller's in-memory store and delivered the next time the panel connects to the gRPC stream.
