---
description: Draw vector geometry and measure distances and areas on the AI-Hydro map.
---

# Draw & Measure

Two tools in the Tool Ribbon let you create geometry and take spatial measurements directly on the map canvas — no external GIS required.

---

## Measure Tool  📏

Click the **📏** icon to activate the Measure tool. Two modes are available:

| Mode | How to use |
|---|---|
| **Distance** | Click two or more points on the map; each segment label shows its length; a running total appears at the endpoint |
| **Area** | Click three or more points to define a polygon; the enclosed area is displayed in km² or ha |

- Press **ESC** or double-click the last point to finish a measurement
- Click 📏 again (or switch tools) to cancel and clear the overlay
- Measurements are **temporary** — they are not saved to the workspace or exported

**Accuracy notes**

- Distance uses the Haversine formula (great-circle, sub-metre accuracy at basin scale)
- Area uses a 2-D planar approximation from projected Web Mercator coordinates — accurate to ~1 % for basins up to 100,000 km²; for precise area calculations on large regions use the Python analysis tools

---

## Vector Draw Tool  ✏️

Click the **✏️** icon to sketch geometry that can be saved as a vector file and used as a region of interest (ROI) for analysis tools.

### Geometry types

| Mode | How to draw |
|---|---|
| **⬡ Polygon** | Click each vertex; double-click to close |
| **〰 Line** | Click each vertex; double-click to finish |
| **● Point** | Single click to place |

### After drawing

A green draft overlay appears on the map, and three action buttons appear at the bottom of the panel:

| Button | Action |
|---|---|
| **Save** | Writes `vectors/<name>.geojson` in the workspace root, registers the geometry as the active ROI under `sessionId='map'`, and adds it as a layer |
| **Export** | Downloads the draft as a `.geojson` file to your Downloads folder without saving to the workspace |
| **Discard** | Clears the draft without saving |

### Using the saved ROI

Once saved, the geometry is immediately available to all MCP analysis tools through the active session:

```python
# Any tool that accepts sessionId will use the drawn ROI
delineate_watershed(session_id="map")
compute_twi(session_id="map")
```

The layer also appears in the Layers panel under its file name and can be styled, exported, or removed like any other vector layer.

### Tips

- Draw a rough watershed outline before running `delineate_watershed` to constrain the search area
- Use a polygon to clip a raster before requesting a transect — the polygon saves as the session ROI automatically
- Saved vectors are plain GeoJSON — open them in QGIS or load them into `geopandas` at any time
