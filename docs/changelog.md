---
description: AI-Hydro VS Code extension changelog — release notes, breaking changes, new tools, and bug fixes for every published version.
---

# Changelog

All notable changes to the AI-Hydro VS Code extension are documented here.
The companion Python package (`aihydro-tools`) has its own changelog at
[github.com/AI-Hydro/aihydro-tools](https://github.com/AI-Hydro/aihydro-tools/blob/main/CHANGELOG.md).

---

## [Unreleased]

---

## [0.1.8] — 2026-05-09

### Map — Multi-format loading, drag-and-drop, symbology editor

The map panel now supports **8 geospatial file formats** that can be loaded by dragging files onto the map, clicking **+ Add Layer**, or dropping into a file picker. Each format is handled by a lazy-loaded adapter so the bundle stays small for users who never use that format.

#### Supported formats

| Format | Extension(s) | Notes |
|---|---|---|
| GeoJSON | `.geojson`, `.json` | Native; also accepts raw Geometry types |
| TopoJSON | `.topojson`, `.json` | Converted via `topojson-client` |
| KML | `.kml` | Converted via `@tmcw/togeojson` |
| KMZ | `.kmz` | ZIP extracted via `jszip`, then KML converted |
| GPX | `.gpx` | Converted via `@tmcw/togeojson` |
| Shapefile | `.zip` | Zipped `.shp + .dbf + .shx + .prj` via `shpjs` |
| GeoTIFF | `.tif`, `.tiff` | Read via `geotiff.js`; rendered with viridis ramp; rejects non-WGS84 |
| CSV | `.csv` | Auto-detects `lon`/`lat`/`longitude`/`latitude`/`x`/`y` columns |

#### Drag-and-drop
- Drop any supported file directly onto the map — a blue dashed drop zone appears while dragging
- A `dragDepthRef` counter prevents false `dragLeave` events from child elements
- A result toast (bottom-centre) reports how many files loaded and any errors

#### Layer panel additions
- **`+ Add Layer…` button** — opens a native file picker filtered to supported extensions; always visible, even when the panel is collapsed
- **Empty state** — when no layers are present, a `🗺️` placeholder lists supported formats so first-time users know what to do
- **Source badges** — every layer row shows one of: 📁 workspace file · 🐍 Python tool output · 📥 user-loaded file · 📤 manually pushed
- **Layer name disambiguation** — when two layers share the same filename (e.g. two `watershed.geojson` files from different folders), the parent folder name is appended to distinguish them

#### Symbology editor
- Click a layer's colour swatch or the 🎨 icon to open an inline editor:
  - **Vector layers**: fill colour + opacity slider, stroke colour + width slider
  - **Raster layers**: colormap selector (viridis, plasma, inferno, magma, cividis, Greens, YlOrRd, RdBu) + opacity slider
- Changes applied immediately

---

## [0.1.7] — 2026-05-08

### Map — Panel redesign, status bar, basemap overhaul, workspace persistence

#### Resize fix
- **ResizeObserver** on the map container replaces `window.addEventListener("resize")` — the map now reflows correctly when VS Code splits or resizes panels, not only on browser-window resize

#### Layer panel
- Always visible in collapsed state — a `📑 +` icon button lets you add layers even after clearing everything
- Drag-resize handle on the left edge; width clamped to 220–480 px
- Panel state (dock, width, section expand) persisted to `localStorage`

#### Map status bar
- **Scale bar** using the Mercator formula: `156 543 × cos(lat) / 2^zoom` m/px, displayed in km or m with a clean tick mark
- **Coordinate readout** from pointer position (`45.4981°N, 69.6018°W` format)
- Styled with VS Code CSS variables (`--vscode-foreground`, `--vscode-editor-background`) for full theme awareness

#### Basemap overhaul — 13 free basemaps, no API token

| Group | Basemaps |
|---|---|
| Hydrology-focused | USGS Imagery, USGS Topo, USGS Shaded Relief, Esri Hillshade, Esri Ocean |
| General purpose | Carto Voyager, Carto Dark, Carto Light, Stadia Terrain, Esri World Topo, Esri Satellite, Humanitarian (HOT) |
| Personal use only | ⚠️ OpenStreetMap (volunteer servers; disallows embedded app traffic) |

Mapbox dependency completely removed.

#### Workspace persistence
`mapWorkspace.ts` — `localStorage` key `aihydro.map.workspace.v1` saves:
active basemap, view state (centre + zoom), visible layer IDs, and panel layout.

---

## [0.1.6] — 2026-05-05

### Map — Python ↔ VS Code layer bridge

- **`MapEventWatcher`** — TypeScript class polls `~/.aihydro/map_events/` every 600 ms; forwards events to the map panel via `controller.addMapLayer()`. Starts on extension activation; stops on dispose
- **`delineate_watershed` auto-push** — watershed boundary polygon + gauge station point pushed automatically after each delineation; map panel opens side-by-side if closed
- **`show_on_map` MCP tool** — push any GeoJSON to the map; accepts style presets (`watershed`, `flowlines`, `gauge`, `default`) and per-key overrides (`fill_color`, `stroke_color`, `fill_opacity`)
- **`compute_twi` auto-push** — pushes `viridis_r` raster tile as `twi_<session_id>` after TWI computation
- **`create_cn_grid` auto-push** — pushes `YlOrRd` tile as `cn_<session_id>` after CN grid generation
- **`BitmapLayer`** in `MapView.tsx` — raster layers routed through deck.gl `BitmapLayer`; vector layers through `GeoJsonLayer`
- **`plot_raster_tile()`** in `analysis/plots.py` — renders a 2-D numpy array as a decoration-free PNG; NaN cells transparent; percentile clipping (P2–P98) prevents outlier wash-out
- **`_bounds_to_wgs84()`** — reprojects raster bounds from any CRS to EPSG:4326 via pyproj; falls back silently

---

## [0.1.5] — 2026-04-18

### Added
- **Three-tier citation system** — every tool call automatically accumulates BibTeX citations for the data sources it uses (USGS NWIS, NHDPlus, 3DEP, GridMET, NLCD, POLARIS, CAMELS-US, HBV). `sync_research_context` writes a ready-to-use `citations.bib` to the workspace; `export_session` embeds citations in every export format. Platform citations (AI-Hydro + aihydro-tools Zenodo DOIs) are always included. Plugin packages can register Tier 3 citations via `register_plugin_citation()`.

### Platform
- **LLM interpretation layer** — `research.md` now has two sections: a Python-generated structural skeleton (always current) and an LLM-authored scientific context section written by the foundation model via `sync_research_context`. Deleted all template-based Python interpretation logic.
- **`sync_research_context` redesigned** — two-phase tool: Phase 1 returns raw session data for LLM reasoning; Phase 2 accepts `interpretation` (scientific prose) and `site_name` and writes permanently to `research.md`.
- **`site_name` field** — sessions carry a human-readable display name set by the LLM, separate from the raw gauge ID.

### Analysis
- **PNG diagnostic outputs** — watershed boundary map, daily hydrograph with 30-day rolling mean, and log-scale flow duration curve are saved automatically when `workspace_dir` is set.
- **New `analysis/plots.py` module** — headless matplotlib plots via Agg backend; silently skips if matplotlib is unavailable.

### Session architecture
- **Lean session JSON** — watershed GeoJSON geometry stored at `~/.aihydro/sessions/<gauge_id>.geojson` (was embedded inline, 200–800 KB per gauge).
- **Project workspace auto-detection** — `ProjectSession.save()` finds `workspace_dir` from any associated gauge session automatically.

### Fixed
- `.aihydrorules/research.md` path corrected throughout (was `.clinerules/research.md` in `session/persona.py` and `session.py` shadow file)
- Shadow `ai_hydro/session.py` deleted — was silently writing to the wrong path when imported
- `fetch_streamflow_data` quickstart example corrected to use `start_date=`/`end_date=` kwargs (positional args caused USGS validation failure)
- Windows PATH table: `Scripts\aihydro-mcp.exe` was mangled to `Scriptsihydro-mcp.exe` (bell char)
- VSIX install example version bumped `0.1.2` → `0.1.5`
- `faq.md` `setup_mcp.py` commands now include `cd python &&` (script is not at repo root)
- CI forbidden-strings guard added — blocks PRs reintroducing stale tool names, deprecated module paths, or `.clinerules` references
- Dead code removed: `RagService.ts`, two commented RAG blocks in `task/index.ts`, stale Cline documentation directories

## [0.1.4] — 2026-04-15

### Added
- **Python env context in `start_session`** — response now includes `mcp_python`
  (the interpreter running the MCP server), `mcp_pip`, and `available_packages`
  (dict of all installed packages with versions). Agents can use this to write
  correct Python scripts without guessing the interpreter path or assuming what
  is installed.
- **`list_available_tools` tool** — returns all registered MCP tools with names,
  descriptions, and parameter schemas at runtime. Includes community plugin tools
  discovered via entry points. Call this to see what capabilities are available
  without relying on hardcoded documentation.
- **`get_library_reference` tool** — per-library reference cards covering field-name
  gotchas, API quirks, unit assumptions, and copy-paste code patterns. Covers 8
  core libraries: pynhd, pygeohydro, pygridmet, py3dep, hydrofunctions, pysheds,
  rasterio, xarray. Call before writing any Python script using these libraries.
- **`aihydro.knowledge` entry point** — community plugins can now contribute
  additional library reference cards by registering a `get_refs_dir` callable
  under `[project.entry-points."aihydro.knowledge"]` in their `pyproject.toml`.
- **Agent instruction improvements** — system prompt now includes explicit Python
  scripting decision tree: call `start_session` first, call `get_library_reference`
  for any library you'll use, then use `mcp_python` as the interpreter. Also
  clarifies that `list_available_tools` is the ground truth for available capabilities.

### Tests
- 4 new smoke tests covering all additions
- Fixed stale `_RESEARCH_MD` patch targets (attribute no longer exists in store.py)
- Updated expected tool count from 16 → 28

---

## [0.1.3] — 2026-04-11

### Fixed
- **Security**: Path traversal vulnerability in `ProjectSession` — `project_name` now
  validated against `^[a-zA-Z0-9_-]{1,64}$` before any filesystem use
- **Critical**: `fetch_streamflow_data` broken on pandas 3.0 — replaced `hydrofunctions`
  with `dataretrieval` (official USGS Python client); all streamflow fetches now work
- **Geomorphic**: Outlet elevation NaN silently coerced to 0.0, cascading to 6 metrics
  returning zero — added nearest-pixel fallback (±3 cells); returns `NaN` explicitly
  if no valid pixel found
- `research.md` and `tools.md` written to `.clinerules/` (old Cline path) instead of
  `.aihydrorules/` — auto-injected research context was not reaching the agent
- `add_note`: parameter `text` renamed to `note`; `add_journal_entry`: `text` → `entry`;
  `get_project_summary`: `name` → `project_name` (consistent with all other project tools)
- `export_session`: default format corrected from `"text"` to `"json"`, third option
  corrected from `"text"` to `"methods"`; `clear_session` docs: `slot` → `slots` (list)
- `train_hydro_model` docs: parameters fully corrected (`framework`, date ranges, `epochs=500`)

---

## [0.1.2] — 2026-04-10

### Added
- **v1.2 Python backend** (aihydro-tools v1.2.0):
  - `ProjectSession`: project-scoped research state spanning multiple gauges/topics
  - `ResearcherProfile`: persistent researcher persona built from interactions
  - 10 new MCP tools → 26 total
  - Folder-based literature indexing (`index_literature`, `search_literature`)
  - Cross-session experiment search (`search_experiments`)
  - Project experiment journal (`add_journal_entry`)
  - Researcher profile tools (`get/update_researcher_profile`, `log_researcher_observation`)
- Memory hierarchy fully documented in agent instructions:
  `ResearcherProfile → ProjectSession → HydroSession → research.md`
- Agent now calls `get_researcher_profile()` at conversation start
- GitHub Pages documentation site (MkDocs Material)
- YouTube channel added to project links

### Changed
- Platform descriptions revised across README, PyPI, and Marketplace for clarity and vision
- Private files (`paper.md`, `branding.md`) excluded from VSIX packaging

---

## [0.1.1] — 2026-04-09

### Changed
- Bumped version 0.1.0 → 0.1.1 for VSIX distribution

### Python backend (aihydro-tools v1.1.0)
- RAG system removed; `query_hydro_concepts` tool removed
- Hardcoded tool-count references replaced with generic language
- RAG files archived to [github.com/AI-Hydro/aihydro-rag](https://github.com/AI-Hydro/aihydro-rag)

---

## [0.1.0] — 2026-03-31

### Added
- Initial public release of AI-Hydro VS Code extension
- Full TypeScript rebranding from Cline → AI-Hydro
- Auto-registration of `ai-hydro` MCP server on extension activation
- Custom agent system prompt for hydrological research workflows
- Python backend: aihydro-tools v1.1.0 (16 MCP tools via `aihydro-mcp`)
- Latest AI model support: Claude 4.6 (Opus/Sonnet), GPT-5.4, Gemini 3.1
- Documentation: `PLUGIN_GUIDE.md`, `docs/tools-reference.md`, `docs/installation.md`
- Community contribution guide: `python/CONTRIBUTING.md`

---

[0.1.2]: https://github.com/AI-Hydro/AI-Hydro/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/AI-Hydro/AI-Hydro/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/AI-Hydro/AI-Hydro/releases/tag/v0.1.0
