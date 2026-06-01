---
description: Compare two map layers side-by-side using the Swipe tool — drag a divider to reveal each layer.
---

# Swipe Comparison

Click the **◩** icon in the Tool Ribbon to open the Swipe tool. Swipe mode overlays two layers on the same basemap and lets you drag a divider handle across the canvas to reveal either side — the standard visual comparison technique for before/after imagery, model output differences, or seasonal raster comparisons.

---

## Activating Swipe Mode

1. Open the Swipe panel (◩ icon)
2. Check **Enable Swipe Tool** — the tool automatically selects the top two visible data layers as the initial left and right layers
3. A `⇔` drag handle appears in the centre of the map

Use the **Left layer** and **Right layer** dropdowns in the panel to change which layers are shown on each side. Any visible layer — raster, GeoTIFF, GEE tile, or vector — can be assigned to either side.

---

## Moving the Divider

Three ways to reposition the divider:

| Method | How |
|---|---|
| **Drag** | Click and drag the `⇔` handle on the map |
| **Arrow keys** | ← / → nudge the divider 5% per press (while Swipe mode is active) |
| **Panel slider** | Drag the **Divider position** range slider in the Swipe panel |

A live **percentage readout** (e.g. `47%`) next to the slider shows the current divider position at all times.

**Snap to center:** Double-click the `⇔` handle, or click the **⟵ Center ⟶** button in the panel, to reset the divider to 50%.

---

## Layer Labels

Both layer names float adjacent to the divider handle at the bottom of the map — the left label hangs off the left edge of the divider and the right label off the right. The labels follow the handle as you drag, so they never overlap the Tool Ribbon or any other UI.

---

## Swapping Layers

Click **⇄ Swap** in the panel to exchange the left and right layer assignments in one step — useful for quickly reversing the comparison direction without touching both dropdowns.

---

## What Stays Visible on Both Sides

The following overlays are always rendered on top of both layers regardless of divider position:

- Basemap (underneath both layers)
- Smart Annotations
- Saved transect lines
- Measurement overlays
- Search pin

---

## Disabling Swipe Mode

Uncheck **Enable Swipe Tool** in the panel, or switch to any other Tool Ribbon panel. The divider disappears, layer assignments reset, and the map returns to normal layered rendering.

---

## Typical Workflows

| Comparison | Left layer | Right layer |
|---|---|---|
| Pre/post flood | Pre-event imagery | Post-event imagery |
| Model comparison | TWI from DEM A | TWI from DEM B |
| Seasonal change | CHIRPS dry season | CHIRPS wet season |
| Land cover change | NLCD 2011 | NLCD 2021 |
| Baseline vs scenario | Baseline CN grid | Modified CN grid |

---

## Tips

- Align both layers to the same spatial extent before enabling Swipe — use the 🔍 zoom-to-layer button in the Layers panel
- If one layer is much more transparent than the other, adjust opacity in the Layers panel before comparing
- For raster layers, switch both to the same colormap (e.g. viridis) so colour differences reflect data differences, not colormap differences
- GEE tile layers can be compared in Swipe mode but cannot be profiled — use a local GeoTIFF on at least one side if you also want transect analysis
- Use **⇄ Swap** to quickly check whether a difference is visually symmetric — if the comparison looks different when flipped, the directionality matters
