---
description: Click anywhere on the map to inspect feature properties, raster values, and trigger AI analysis or watershed delineation.
---

# Feature Inspector

Click anywhere on the map canvas (outside of any active drawing tool) to open the **Feature Inspector**. The inspector shows what is at that exact point across all visible layers and provides one-click actions to start an agent workflow.

---

## What the Inspector Shows

| Section | Contents |
|---|---|
| **Coordinates** | WGS84 decimal lat/lon of the click point; click to cycle to DMS or UTM format |
| **Vector features** | Properties of every visible vector feature at that point — layer name, feature ID, all attribute key/value pairs |
| **Raster value** | Pixel value from the topmost visible analysis-ready raster at that point, with the layer name and units |
| **All raster values** | Expand to see readings from every visible raster that has pixel data at the clicked location |

> **Raster readings require a local GeoTIFF with raw pixel values loaded.** Python-pushed preview PNGs and GEE tiles do not return per-pixel values. If the raster section is empty, open the Layers panel → click the raster's 🎨 icon → **Load raster values**.

---

## Actions

| Button | What it does |
|---|---|
| **Quick Delineate** | Runs `delineatePoint(lon, lat)` immediately in the background — the watershed boundary and outlet appear on the map within seconds without opening the chat |
| **Delineate (agent)** | Opens the chat panel with a pre-filled prompt describing the clicked location and requesting a full watershed delineation |
| **Ask AI** | Opens the chat with a context-rich prompt that describes the click point, all visible layers, and any vector features found there — ready for any ad-hoc question |

---

## Cursor Value Probe (Hover Mode)

While the Feature Inspector is not blocking, moving the cursor over the map shows a **live cursor value** in the Map Status Bar for the topmost visible analysis-ready raster — no click needed. This is useful for quickly scanning a raster for value ranges without recording a reading.

---

## Tips

- **Quick Delineate** is the fastest way to delineate a watershed — one click on the outlet, one button press, result in ~5 seconds
- Click a vector feature (watershed polygon, gauge point, MERIT river reach) to see all its properties before asking the agent about it — knowing the HUC8 code or gauge ID lets you write a more specific prompt
- If multiple vector layers overlap at a point, the inspector lists features from all of them — useful for checking whether a point falls inside a flood zone, a specific soil type, and a particular HUC simultaneously
- The **Copy coordinates** button in the inspector copies the lat/lon to the clipboard in the currently displayed format (decimal, DMS, or UTM)
