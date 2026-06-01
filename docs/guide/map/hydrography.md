---
description: Load MERIT river networks, WBD watershed boundaries, USGS gauges, and dams — plus manage your personal Gallery and browse community artifacts.
---

# Hydrography & Gallery

Two panels in the Tool Ribbon provide access to global hydrography reference data and a three-tab Gallery where you can save, organise, and import reusable map artifacts.

---

## Hydrography Panel  🌊

Click the **🌊** icon to open the Hydrography panel. All layers are fetched via the MCP server and pushed through the gRPC stream — they appear on the map without reloading the page.

### Available layers

| Button | What loads |
|---|---|
| **MERIT rivers (region)** | MERIT-Hydro river network clipped to the current map view extent |
| **MERIT rivers (basin)** | MERIT-Hydro rivers for the active ROI basin (requires an active session ROI) |
| **WBD / HUC boundaries** | USGS Watershed Boundary Dataset — HUC 2, 4, 6, and 8 boundaries at the current zoom |
| **HUC at point** | The HUC polygon that contains the last clicked point |
| **Gauges in view** | USGS stream gauge stations within the current map extent |
| **Dams in view** | National Inventory of Dams (NID) entries within the current map extent |

### MERIT-Hydro

MERIT-Hydro is a global, multi-directionally conditioned flow network derived from the MERIT DEM (90 m). The river network covers latitudes from ~60°S to ~84°N and is the recommended reference for delineation workflows.

Loaded MERIT layers arrive as vector line features. Each reach carries upstream area (`uparea_km2`), flow direction, and Pfafstetter codes — click a reach in the Feature Inspector to read these attributes.

### WBD (Watershed Boundary Dataset)

The USGS WBD covers the contiguous US, Alaska, Hawaii, and US territories. Boundaries are loaded at the HUC level appropriate for the current zoom:

| Zoom | HUC level | Approx. area |
|---|---|---|
| ≤ 6 | HUC-2 | Major drainage region |
| 7–9 | HUC-4 | Subregion |
| 10–12 | HUC-6 | Basin |
| ≥ 13 | HUC-8 | Subbasin |

Click any HUC polygon in the Feature Inspector to see its HUC code, name, and area.

### USGS Gauges

Loaded gauge layers are point features. Each gauge carries the USGS site number, station name, and datum — click a gauge point to read these, then use the site number in `fetch_streamflow_data(gauge_id=...)` to pull the discharge record.

---

## Gallery  🧭

Click the **🧭** icon to open the Gallery panel. It has three tabs:

| Tab | What it holds |
|---|---|
| **Mine** | Artifacts you have saved — map scenes, transect collections, annotation collections |
| **Starred** | Community artifacts you have bookmarked for quick access |
| **Community** | Published artifacts from the AI-Hydro community catalog |

---

### Mine — Your Personal Gallery

**My Gallery** is a personal, offline store backed by `localStorage`. Everything in it persists across sessions and survives map refreshes.

#### Artifact types you can save

| Type | Icon | Saved from |
|---|---|---|
| Map scene | 🗺 | Gallery toolbar — "+ Save scene" |
| Transect collection | 📈 | Transects panel — "📌 Save to My Gallery" |
| Annotation collection | 💬 | Annotations panel — "📌 Save to My Gallery" |

#### Saving a map scene

1. Open the Gallery and make sure you are on the **Mine** tab.
2. Click **+ Save scene**.
3. A form expands with three fields:
   - **Title** — pre-filled with today's date; edit to something meaningful (e.g., "TWI Basin Pre-calibration").
   - **Description** — optional free-text notes.
   - **Tags** — comma-separated keywords (e.g., `basin, twi, pre-cal`). Live tag chips appear as you type.
4. Click **Save**. The scene is stored immediately and appears at the top of the list.

A saved map scene captures: basemap, camera position (longitude, latitude, zoom, bearing, pitch), visible layer IDs, and layer opacities. It does not capture layer data — layers must be loaded when you restore the scene.

#### Saving a transect collection

From the **Transects panel** (Tool Ribbon → transect icon):

1. Optionally select a collection tab to scope the save to that collection only. If "All" is active, every transect is saved.
2. Click **📌 Save to My Gallery** in the panel footer.
3. A form expands — fill in title, description, and tags, then click **Save**.

The save stores the full transect geometries, profile metadata, colors, and collection membership.

#### Saving an annotation collection

Identical flow — open the **Annotations panel**, click **📌 Save to My Gallery**, fill the form.

#### Managing saved items

Each card in the Mine list shows:

- Type icon and title
- Content summary (e.g., `"ESRI Imagery · 4 layers · zoom 11.2"` for a scene, `"5 transects · 2 collections"` for a transect set)
- Tags and relative timestamp

**Click a card** to expand it and reveal action buttons:

| Button | Action |
|---|---|
| ↩ Restore scene / Add transects / Add annotations | Import the artifact onto the current map (type-aware label) |
| ✎ Edit | Expand title, description, and tag fields in place — click Save to confirm |
| 📌 (pin icon) | Toggle pin — pinned items float to the top of the list |
| ✕ Delete | First click shows "Confirm delete" — click again to confirm; click Cancel to abort |

**Import feedback** — after importing, a status message appears at the bottom of the panel:

- *"Restored 'My Basin' — 4 layers (2 not yet loaded — add them first)"* — for scenes where some saved layers are not currently loaded
- *"Added 3 transects · 1 already existed"* — for transect imports; skips duplicates silently by ID
- *"All 5 annotations from 'X' already on map"* — if every annotation is already present

Imported transects and annotations are merged into your current set and immediately saved to `localStorage` — they persist across refreshes.

#### Filtering and search

- The **type dropdown** filters to a specific artifact type (All types / Map scene / Transect collection / Annotation collection / …).
- The **search box** matches against title, description, and tags.

---

### Starred — Bookmarked Community Items

The **Starred** tab shows community catalog items you have bookmarked. Bookmarks are stored locally alongside your gallery and do not require an account.

To bookmark a community item, go to the **Community** tab, expand a card, and click the **☆** star in the card header. It turns filled (★) and the item appears in Starred.

Clicking **↩ Import to map** on a starred community card goes through the same import pipeline as the Community tab.

---

### Community — Published Catalog

The **Community** tab fetches the AI-Hydro Gallery catalog (hosted on GitHub Pages). It loads once per session; if the network is unavailable it falls back to a built-in snapshot.

#### Artifact types

| Type | Description |
|---|---|
| `map_scene` | Saved layer stack, styles, and view state for a specific study area |
| `style_preset` | Named symbology configuration (colormap, graduated breaks, stroke style) |
| `case_study` | Documented analysis workflow with associated layers and screenshots |
| `dataset_connector` | Configuration for a remote dataset source (GEE collection, OGC service, S3 bucket) |
| `map_plate_template` | Pre-configured Map Plate Composer layout |

#### Trust levels

| Level | Meaning |
|---|---|
| **Official** | Created and maintained by the AI-Hydro team — fully validated |
| **Reviewed** | Community submission that has passed schema and provenance checks |
| **Community** | Unreviewed community contribution — use with awareness |
| **Local** | Artifact from your own workspace |

#### Filtering and sorting

Use the three dropdowns above the list to filter by **type**, **trust level**, and **sort order** (Recommended / Most imports / Most starred / Newest / Name). The search box filters across title, description, author, and tags.

#### Importing a community artifact

Click any card to expand it, then click **↩ Import to map**. The artifact goes through source, provenance, licence, and readiness checks. A toast confirms success or reports any validation errors.

#### Stars vs bookmarks

Each community card has two interaction targets:

| Icon | What it does |
|---|---|
| ☆ / ★ (filled) | **Bookmark** — saves the item to your local Starred tab; no account required |
| ✩ / ⭐ (filled) | **AI-Hydro star** — records a public star on the catalog server (requires connectivity); shows the item's global star count |

#### Contributing

At the bottom of the Community tab is a link to open the GitHub contribution template. You can share scenes, styles, datasets, case studies, or plate templates with the community by submitting a pull request.

---

## Location Search  🔍

Click the **🔍** icon to open the search bar. Type a place name, address, or geographic feature to geocode and fly to it.

- Results appear as you type using **Nominatim / OpenStreetMap** geocoding
- The current map viewport is used as a geographic bias so results near the active basin rank higher
- Clicking a result flies to the location and drops a **pulsing pin marker** on the map

The search pin is temporary and clears when you click elsewhere on the map.

---

## Tips

- **Name scenes after workflow milestones** — "Pre-calibration view", "Post-delineation", "Peer review snapshot". Restore them later without reconfiguring layer visibility or zoom.
- Load **MERIT rivers (region)** first to visually confirm channel locations before placing a transect or annotation on a reach.
- Use **HUC at point** after clicking a location in the Feature Inspector — it fetches the containing HUC boundary and adds it as a polygon layer in one step.
- **Gauges in view** returns all active USGS gauges — note the site numbers, then use them with `fetch_streamflow_data` to pull decades of discharge data in a single agent request.
- When restoring a scene that references layers not yet loaded, the status message tells you exactly how many are missing — load those layers first, then restore again.
- Use **tags** to group saves across types: tag a transect set, an annotation collection, and a scene all as `"fieldwork-june"` so they are findable together via the search box.
- The Research Gallery's `map_plate_template` artifacts let you apply a pre-styled layout (fonts, DPI, element positions) to a new study area without reconfiguring the composer from scratch.
