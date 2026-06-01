---
description: Mark features with Smart Annotations, record field notes, organize into collections, and trigger AI analysis — all from the map canvas.
---

# Smart Annotations

Click the **💬** icon in the Tool Ribbon to open the Smart Annotations panel. Annotations let you flag locations and features on the map, record field observations, organize work into named collections, and dispatch each annotation — or a whole batch — to the AI-Hydro agent for analysis.

---

## Drawing an Annotation

Three geometry types are available:

| Button | Geometry |
|---|---|
| **📍 Pin** | Single point — gauges, outlets, sample sites |
| **⬠ Poly** | Polygon — catchment outlines, flood extents |
| **〰 Line** | Polyline — reach segments, roads, transects |

Click the button, draw on the map (single click for a pin; click vertices then double-click to finish for poly/line), and the annotation is saved immediately as a compact card in the panel.

---

## Annotation Card

Each annotation shows a **collapsed card** with its colour swatch, geometry type, name, and quick actions. Click **▼** to expand the full editor.

### Expanded card fields

| Field | Purpose |
|---|---|
| **Name** | Editable inline label (default: `Annotation N`) |
| **📓 My Notes** | Your field observations — sent to the agent as background context |
| **🤖 AI Prompt** | An explicit instruction for the agent (e.g. "Delineate the watershed at this point"). Leave blank to use the smart default based on your notes. |
| **Tags** | Comma-separated keywords for filtering |
| **Status** | `new` · `active` · `complete` · `archived` |
| **Priority** | `low` · `medium` · `high` · `critical` |
| **Colour** | HTML colour picker — the pin/polygon on the map updates immediately |

### Quick actions (collapsed card)

| Button | Action |
|---|---|
| **📍 Fly to** | Zoom the map to the annotation's bounding box |
| **✨ Ask Agent** | Send this annotation to the AI agent |
| **🗑️ Delete** | Remove the annotation (no undo) |

---

## Asking the Agent

Click **✨ Ask Agent** on any card. The agent receives:

- The geometry (coordinates / polygon vertices)
- Your **My Notes** text as background context
- The **AI Prompt** as the explicit instruction (or a smart default if blank)
- The list of currently visible layers and their names

The agent's response appears in the chat panel. Typical workflows:

- *"Delineate the watershed at this outlet"* → `delineate_watershed` is called and the boundary is pushed back to the map automatically
- *"What land cover dominates this polygon?"* → agent fetches NLCD and summarizes by class
- *"Flag if this reach has upstream dams"* → agent queries the NID API

---

## Collections

Collections group related annotations into named tabs — one field visit, one sub-basin, one project phase.

### Creating and managing collections

| Action | How |
|---|---|
| **+ Collection** | Click the button above the tab row to create a new collection |
| **Assign annotation** | In the expanded card, click the collection name buttons under "Collections" |
| **Switch collection** | Click the tab at the top of the panel |
| **Rename** | Double-click the tab label |
| **Delete** | Click **✕** on the tab (annotations move to the default collection) |

The **All** tab always shows every annotation regardless of collection.

### Batch analysis

While viewing any collection tab, click **✨ Batch Ask Agent** to send the entire collection to the agent in a single request. The agent receives a summary table of all annotations (coordinates, geometry type, notes, AI prompt) and produces a consolidated analysis — useful for comparing multiple potential outlet points, or reviewing all flagged reaches before fieldwork.

---

## Exporting Annotations

Click **⬇ Export ▾** to choose a format:

| Format | Use case |
|---|---|
| **📊 CSV** | Spreadsheet / database import |
| **🌐 GeoJSON** | Web mapping, `geopandas`, QGIS |
| **🌍 KML** | Google Earth, field GPS apps |
| **📦 Shapefile (.zip)** | QGIS, ArcGIS, most desktop GIS |
| **📝 Markdown report** | Meeting notes, field reports, documentation |

Export targets the **current collection tab** (or all annotations when on the All tab). The filename includes today's date.

---

## Persistence

Annotations are saved to `localStorage` under the key `aihydro.map.annotations.v1`. They survive panel close, VS Code restart, and extension update — nothing is lost unless you explicitly delete or clear.

> **Tip:** Export to GeoJSON periodically as a backup, especially before long batch analysis sessions.

---

## Tips & Workflows

- Place a **📍 Pin** at each potential outlet point before running batch delineation — the batch prompt sends all coordinates at once, letting the agent compare drainage areas in a single reply
- Use **Priority: critical** for sites that need field verification first; filter by priority in the search bar
- Assign **Tags** like `#dryseason` or `#flooding` then filter the panel to that tag when reviewing a specific phenomenon
- The **🌍 KML export** is ready for import into Google Earth or any field data app that accepts KML
