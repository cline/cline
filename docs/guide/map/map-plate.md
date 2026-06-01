---
description: Compose publication-quality map figures from the live canvas — choose a template, add cartographic elements, and export at print resolution.
---

# Map Plate Composer

Click the **🖼️** icon in the Tool Ribbon to open the Map Plate Composer. The composer renders the live map canvas into a formatted plate — with title, legend, north arrow, scale bar, and graticule — ready for journal submission, thesis chapters, technical reports, or presentations.

---

## Templates

| Template | Size | Orientation | Best for |
|---|---|---|---|
| **Manuscript** | 6.5 × 9 in | Portrait | Journal submissions |
| **Single-column** | 3.3 × 4.6 in | Portrait | Narrow-column journal figures |
| **Thesis** | 8.5 × 11 in | Portrait | Dissertation chapters |
| **Report** | 8.5 × 11 in | Landscape | Technical reports |
| **Presentation 16:9** | 13.33 × 7.5 in | Landscape | Conference slides |
| **Presentation 4:3** | 10 × 7.5 in | Landscape | Classic slide format |
| **Square** | 8 × 8 in | Square | Web / social media |

Select a template from the dropdown — the preview updates immediately.

---

## Map Elements

Each element can be toggled on/off independently:

| Element | Description |
|---|---|
| **Title** | Main map title — editable text field |
| **Subtitle** | Secondary line below the title |
| **North arrow** | Classic N-arrow with white backing disc |
| **Scale bar** | Physical distance bar labeled in km |
| **Legend** | Layer list with colour swatches and display names |
| **Color ramp** | Graduated colour scale card for raster layers — reads the actual colormap and min/max pixel values from the live layer |
| **Graticule** | Lat/lon grid lines or tick marks with degree labels (e.g. 28°N, 76°E) |
| **Attribution** | Basemap source credit (required by tile licences) |
| **Watermark** | Frosted-glass AI-Hydro badge |
| **Author / Project** | Shown in the plate caption area |
| **Notes** | Free-form text below the caption |

### Color ramp card

The color ramp element reads the actual colormap name and min/max pixel values from the raster cache — the same data source as the live map legend. The exported plate always matches exactly what you see on screen without any manual entry.

---

## Text Options

| Option | Choices |
|---|---|
| **Font family** | System (default) · Times New Roman · Georgia · Arial · Courier New |
| **Alignment** | Left · Center · Right (per-element) |

---

## DPI Options

| DPI | Use |
|---|---|
| 72 | Screen display |
| 150 | Draft print |
| 300 | Standard print (most journals) |
| 600 | Archival / high-quality print |

---

## Export Formats

| Format | Notes |
|---|---|
| **PNG** | Lossless raster at the specified DPI |
| **JPEG** | Compressed raster — smaller file, slightly lower quality |
| **PDF** | Raster image embedded in a PDF page at the correct physical size |
| **Quick export** | Instant PNG of the current canvas without any plate layout — useful for screenshot-style captures |

---

## Preview

- Click **Refresh preview** to generate the first preview render
- After the first render, the plate **auto-refreshes** (700 ms debounce) whenever you change any setting — title edits, element toggles, font changes, or DPI changes all trigger an automatic update
- Click **Expand** to view the full-size preview in a modal overlay; press **ESC** or click outside to close

---

## Tips

- For journal submission, check the target journal's figure width requirements — use **Single-column** (3.3 in) or **Manuscript** (6.5 in) to match the text column width exactly
- Turn off the **Watermark** for final publication exports
- Include the **Color ramp** element whenever the map contains a raster — reviewers expect a legend with min/max values
- The **Graticule** at low zoom levels (whole-basin view) helps orient readers who are unfamiliar with the study region
- Export at **300 dpi PNG** for most journals; switch to **600 dpi** only if the journal explicitly requires it — file sizes at 600 dpi are significantly larger
