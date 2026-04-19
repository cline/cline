---
description: The AI-Hydro map panel — visualize watershed boundaries, gauge points, and custom GeoJSON layers directly inside VS Code.
---

# Map Panel

The AI-Hydro map panel is a side-by-side webview that renders geospatial analysis outputs as interactive layers. Watershed boundaries, gauge locations, and any GeoJSON geometry you pass to `show_on_map` appear here automatically — no copy-pasting coordinates into an external tool.

---

## Opening the Map

Click the **Map** button in the AI-Hydro sidebar toolbar, or run the command palette entry `AI-Hydro: Open Map`. The panel opens in VS Code's editor column 2 (side-by-side with chat).

When the map opens, all `*.geojson`, `*.kml`, `*.gpx`, `*.topojson`, and `*.shp` files in your workspace are loaded as **hidden** layers. Toggle them on from the Layers panel on the left.

---

## Layers Added by Analysis Tools

Once you have AI-Hydro's Python backend installed, analysis tools push layers automatically:

| Tool | Layer pushed | Type |
|---|---|---|
| `delineate_watershed` | Watershed boundary polygon + gauge point | Vector |
| `compute_twi` | TWI grid (`viridis_r` colourmap, 70% opacity) | Raster |
| `create_cn_grid` | Curve Number grid (`YlOrRd` colourmap, 70% opacity) | Raster |
| `show_on_map` | Any GeoJSON you pass explicitly | Vector |

The map panel opens automatically when the first layer arrives (controlled by `open_map=True` inside the event, which is the default).

---

## `show_on_map` Tool

Use this to visualise any geometry your analysis produces:

```python
# Inside an agent session
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

You can override any style key individually:

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

## Basemaps

Use the dropdown in the top-right corner to switch between 9 free basemaps plus optional Mapbox styles (requires a Mapbox token in extension settings).

**Hydrology-focused basemaps (no token needed)**

| Name | Best for |
|---|---|
| USGS Topo | Watershed context, road networks |
| USGS Imagery | Aerial / satellite verification |
| USGS Shaded Relief | Terrain and slope visualisation |
| Terrain (Stadia) | Elevation relief |

**General basemaps**: Dark (Carto), Light (Carto), OpenStreetMap, Esri Satellite, Humanitarian (HOT).

---

## Layers Panel

The panel on the left of the map lists all active layers. Per layer you can:

- **Toggle visibility** — checkbox
- **Zoom to extent** — 🔍 button fits the map to the layer's bounding box
- **Remove** — ✕ removes the layer from the map (does not delete the source file)
- **Clear all** — footer button removes all layers (with inline confirmation)

Workspace files (auto-loaded from disk) show a 📁 badge and can be shown/hidden in bulk via the **Show All / Hide All** workspace controls.

---

## Loading a File Manually

Run `AI-Hydro: Load GeoJSON to Map` from the command palette to pick any geo data file with a system dialog. Supported formats: **GeoJSON, KML, GPX, TopoJSON, FlatGeobuf, Shapefile (.shp + .dbf + .prj)**.

---

## How the Python ↔ Map Bridge Works

When a Python tool calls `show_on_map` (or `push_layer` from `ai_hydro.mcp.map_events`), it writes a small JSON event file to `~/.aihydro/map_events/`. The VS Code extension polls that directory every ~600 ms, reads each file, calls `controller.addMapLayer()`, and deletes the file. The map panel receives the layer via gRPC streaming and renders it immediately.

This means the map works even if the map panel was closed when the tool ran — the layer will appear the next time you open the panel (it is held in the Controller's in-memory layer store until VS Code restarts).

---

## Roadmap

Coming in future releases:

- **Raster layer support** — render GeoTIFF DEMs, TWI grids, and CN grids as colour-mapped bitmap layers
- **Draw tools** — sketch a custom AOI polygon and pass it directly to watershed delineation
- **Layer persistence** — save the active layer set to `HydroSession` so layers survive VS Code restarts
- **Attribute-driven styling** — colour features by any property (stream order, soil class, CN value) with an auto-legend
