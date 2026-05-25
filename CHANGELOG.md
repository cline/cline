# Changelog — AI-Hydro VS Code Extension

All notable changes to the AI-Hydro VS Code extension are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).
Versioning follows [Semantic Versioning](https://semver.org/).

The companion Python package (`aihydro-tools`) has its own changelog at
`github.com/AI-Hydro/aihydro-tools/CHANGELOG.md`.

---

## [Unreleased]

---

## [0.2.0] — 2026-05-25

A focused release on the HTML Preview panel: full course-mode (multi-module
guided learning paths), production-grade visual edit mode, and the DeepSeek
V4 model family in the API picker.

### Added — Course mode (HTML Preview)

End-to-end teaching-and-learning support for HTML modules grouped under a
`course.json` manifest. The student sees a curriculum + progress bar; the
agent (via `aihydro-tools` 1.7.0) sees the same state and can navigate,
gate, or unlock modules on the student's behalf.

- **`CourseHeader`** — strip above the toolbar showing course title, authors,
  module-N-of-M, ✓ / 🔒 status, completion %, prev/next navigation, "Mark
  complete & continue", and a kebab menu with two-step Reset Progress.
- **`CourseNavigator`** — sidebar accordion replacing the Files panel when
  a course is open. Numbered module list, cyan stripe on current, green ✓
  on completed, locked rows greyed with prereq tooltip, mini progress bar.
- **`useCourse` + `useCourseProgress`** — webview hooks fetching the
  course manifest (via host walk-up from any module's path) and per-course
  progress (round-tripped through the extension host, persisted to
  `~/.aihydro/course_progress/<id>.json`).
- **Agent ↔ Preview bridge:**
  - Webview writes `~/.aihydro/active_course.json` whenever a course is
    in view, so the agent's `course_get_state` MCP tool knows which course
    without the user pasting paths.
  - Extension host watches `~/.aihydro/course_nav_intent.json` (written by
    the agent's `course_navigate` MCP tool); fresh intents trigger a tab
    switch through the same prerequisite gate the Next button uses.
- **`examples/courses/intro-to-hydrology/`** — three-module reference
  course (Reading a hydrograph → Exploring CONUS streamflow → DEM to TWI)
  demonstrating prerequisites, estimated minutes, and abstracts.

### Added — Production-grade visual edit mode

- **Real-change detection** — `input` event + `MutationObserver` on
  `[data-aihydro-editable="prose"]` elements (replaces the false-positive
  "Save activates on every toolbar click" behaviour of the prior build).
- **Undo / redo** — keyboard (`⌘Z` / `⌘⇧Z` / `Ctrl+Y`) + toolbar buttons
  tied to `document.queryCommandEnabled('undo'|'redo')` for accurate
  enabled/disabled state.
- **Save button** — only activates when there are pending text edits AND
  no save is in flight; shows "Saving…" mid-flight.
- **Edit-context ribbon** — replaces the per-comment modal dialog with a
  persistent toolbar (B / I / U / H1-3 / list / link / Undo / Redo / Save).

### Fixed — Prev / Next navigation

- **`loadWorkspaceFile`** — previously created a new tab but never
  activated it, so Next ▶ appeared to do nothing. Now fetches updated
  items, finds the target by path, and explicitly activates it.
- **Tolerant path matching** — `pathsEqual()` normalises slashes, trims
  trailing separators, and is case-insensitive (macOS HFS+ / NTFS) so a
  freshly-resolved navigation target matches its already-open tab even
  when the path string isn't byte-identical. Fast path skips the
  `previewHtml` round-trip entirely when the tab is already open.

### Added — DeepSeek V4 model family

- **`deepseek-v4-flash`** (new default) — 1M context, 384K max output,
  $0.28/M output, $0.0028/M cache reads.
- **`deepseek-v4-pro`** — premium V4 with thinking mode for complex
  reasoning; same 1M context.
- **`deepseek-chat` / `deepseek-reasoner`** retained as deprecated aliases
  with accurate v4-flash pricing surfaced in the picker.
- Provider code unchanged — the legacy R1-format conversion still
  triggers for the `deepseek-reasoner` alias.

### Companion releases

- **`aihydro-tools` 1.7.0** on PyPI — five new `course_*` MCP tools
  (`get_state`, `get_curriculum`, `set_progress`, `navigate`, `scaffold`).
- **`AI-Hydro/Skills`** — new `course-authoring` skill broadcast via the
  GitHub Pages marketplace; pairs with `course_scaffold` per the
  established skill+tool pattern.

### System prompt

- `aihydro-tools` 1.7.0 ships a new COURSE MODE section directing the
  agent to treat itself as a teaching assistant when a course is active
  and require explicit user agreement before mutating progress.

---

## [0.1.8] — 2026-05-09

### Map — Multi-format file loading, drag-and-drop, symbology editor

#### Format adapters
- **GeoJSON / TopoJSON** — client-side parsing; TopoJSON converted via `topojson-client`
- **KML / KMZ** — converted via `@tmcw/togeojson`; KMZ ZIP extracted via `jszip`
- **GPX** — converted via `@tmcw/togeojson`
- **Shapefile (.zip)** — zipped `.shp + .dbf + .shx + .prj` bundle via `shpjs`
- **GeoTIFF** — read via `geotiff.js`; rendered with viridis ramp to base64 PNG; rejects non-WGS84 with helpful error
- **CSV** — auto-detects `lon`/`lat`/`longitude`/`latitude`/`x`/`y` columns; handles quoted fields

#### Drag-and-drop
- Drop any supported file directly onto the map — blue dashed drop zone appears while dragging
- `dragDepthRef` counter prevents false `dragLeave` events from child elements
- Result toast (bottom-centre) reports `n loaded, n skipped` with error details

#### Layer panel additions
- **`+ Add Layer…` button** — opens native file picker filtered to supported extensions
- **Empty state** — when no layers are present, a `🗺️` placeholder lists supported formats
- **Source badges** — 📁 workspace file, 🐍 Python tool output, 📥 user-loaded file, 📤 manually pushed
- **Layer name disambiguation** — `buildDisplayNames()` appends parent folder when two layers share the same basename (e.g. two `watershed.geojson` files)

#### Symbology editor
- Per-layer inline editor (click swatch or 🎨 icon to open):
  - **Vector**: fill colour + opacity, stroke colour + width
  - **Raster**: colormap selector (8 options: viridis, plasma, inferno, magma, cividis, Greens, YlOrRd, RdBu) + opacity
- Changes applied immediately via `MapServiceClient.addMapLayer`

#### Dependencies added
- `shpjs ^6.2.0`, `@tmcw/togeojson ^7.1.2`, `geotiff ^3.0.5`, `jszip`, `topojson-client`, `@types/geojson`, `@deck.gl/widgets ~9.2.0`

#### Dependencies removed
- `mapbox-gl`, `react-map-gl`, `kepler.gl` (were unused)

---

## [0.1.7] — 2026-05-08

### Map — Panel redesign, status bar, basemap overhaul, persistence

#### Resize fix
- **ResizeObserver** on the map container div replaces `window.addEventListener("resize")` — map now resizes correctly when VS Code panels are resized or split, not just on window resize

#### Layer panel
- Panel is always visible — collapsed state shows a `📑 +` icon button so layers can always be added even after clearing all layers
- Drag-resize handle on left edge (220–480 px range)
- Collapsible details section for per-layer metadata
- Panel state (dock, width, expanded) persisted to `localStorage`

#### Map status bar
- Scale bar using Mercator ground-resolution formula: `156543 × cos(lat) / 2^zoom` m/px
- Coordinate readout from `onHover` (`45.4981°N, 69.6018°W` format)
- Styled with VS Code CSS variables for theme consistency

#### Basemap overhaul (13 free basemaps, no token needed)
- **Hydrology-focused** (top of list): USGS Imagery, USGS Topo, USGS Shaded Relief, Esri Hillshade, Esri Ocean
- **General purpose**: Carto Voyager, Carto Dark, Carto Light, Stadia Terrain, Esri World Topo, Esri Satellite, Humanitarian (HOT)
- **OSM direct** — demoted to last slot with ⚠️ warning (volunteer servers; disallows embedded app traffic)
- Removed Mapbox dependency entirely

#### Workspace persistence
- `mapWorkspace.ts` — `localStorage` key `aihydro.map.workspace.v1` saves: active basemap, view state (center + zoom), visible layer IDs, panel layout

---

## [0.1.6] — 2026-05-05

### Map — Python ↔ VS Code layer bridge

- **`MapEventWatcher`** — TypeScript class polls `~/.aihydro/map_events/` every 600 ms and forwards layer events to the map panel via `controller.addMapLayer()`. Starts on extension activation; stops on dispose
- **`delineate_watershed` auto-push** — watershed boundary polygon and gauge station point pushed automatically after every successful delineation; map panel opens side-by-side if closed
- **`show_on_map` MCP tool** — explicit tool for pushing any GeoJSON to the map. Accepts style presets (`watershed`, `flowlines`, `gauge`, `default`) and per-key overrides (`fill_color`, `stroke_color`, `fill_opacity`)
- **`compute_twi` auto-push** — pushes `viridis_r` raster tile as layer `twi_<session_id>` after TWI computation
- **`create_cn_grid` auto-push** — pushes `YlOrRd` tile as layer `cn_<session_id>` after CN grid generation
- **`BitmapLayer`** — raster layers routed through deck.gl `BitmapLayer`; vector layers through `GeoJsonLayer`
- **`plot_raster_tile()`** in `analysis/plots.py` — renders numpy array as decoration-free PNG with NaN-transparent cells; percentile clipping (P2–P98) prevents outlier wash-out
- **`_bounds_to_wgs84()`** — reprojects raster bounds from any CRS to EPSG:4326 via pyproj; falls back silently if pyproj is unavailable

---

## [0.1.5] — 2026-04-18

### Added
- **Three-tier citation system** — every tool call automatically accumulates BibTeX citations.
  `sync_research_context` writes `citations.bib`; `export_session` embeds citations in every format.
- **LLM interpretation layer** — `research.md` gains a science-prose section written by the model via `sync_research_context` (two-phase: Phase 1 returns raw data; Phase 2 accepts prose).
- **PNG diagnostic outputs** — watershed map, daily hydrograph, and log-scale FDC saved to workspace automatically.
- **`analysis/plots.py`** — headless matplotlib plots via Agg backend.
- **Lean session JSON** — watershed GeoJSON stored separately at `~/.aihydro/sessions/<gauge_id>.geojson` (was embedded inline, 200–800 KB per gauge).

### Fixed
- `.aihydrorules/research.md` path corrected (was `.clinerules/research.md`)
- Shadow `ai_hydro/session.py` deleted — was silently writing to wrong path
- `fetch_streamflow_data` positional-arg error corrected to use `start_date=`/`end_date=` kwargs

---

## [0.1.4] — 2026-04-15

### Added
- **Python env context in `start_session`** — response includes `mcp_python`, `mcp_pip`, `available_packages`
- **`list_available_tools` tool** — runtime tool registry with schemas; includes plugin tools
- **`get_library_reference` tool** — reference cards for 8 core hydrological libraries
- **`aihydro.knowledge` entry point** — community plugins can contribute additional library cards

---

## [0.1.3] — 2026-04-11

### Fixed
- **Security**: Path traversal in `ProjectSession` — `project_name` validated against `^[a-zA-Z0-9_-]{1,64}$`
- **Critical**: `fetch_streamflow_data` broken on pandas 3.0 — replaced `hydrofunctions` with `dataretrieval` (official USGS Python client)
- Geomorphic outlet elevation NaN silently coerced to 0.0 — fixed with nearest-pixel fallback
- `research.md` / `tools.md` written to `.clinerules/` instead of `.aihydrorules/` — agent context was not being injected

---

## [0.1.2] — 2026-04-10

### Added
- **v1.2 Python backend** (aihydro-tools v1.2.0) integrated:
  - `ProjectSession`: project-scoped research state spanning multiple gauges/topics
  - `ResearcherProfile`: persistent researcher persona built from interactions
  - 10 new MCP tools → 26 total
  - Folder-based literature indexing (`index_literature`, `search_literature`)
  - Cross-session experiment search (`search_experiments`)
  - Project experiment journal (`add_journal_entry`)
  - Researcher profile tools (`get/update_researcher_profile`,
    `log_researcher_observation`)
- **Memory hierarchy** fully documented in agent instructions:
  `ResearcherProfile → ProjectSession → HydroSession → research.md`
- Agent now calls `get_researcher_profile()` at conversation start to recall
  who the researcher is and tailor responses accordingly.

### Changed
- `python/ai_hydro/mcp/app.py`: agent instructions rewritten with memory
  hierarchy, project workflow, and literature workflow sections.
- `python/ai_hydro/session/__init__.py`: exports `ProjectSession`,
  `ResearcherProfile` alongside `HydroSession`.
- `python/ai_hydro/session/store.py`: `write_research_context()` now appends
  researcher profile block to `.clinerules/research.md`.

---

## [0.1.1] — 2026-04-09

### Changed
- Bumped version 0.1.0 → 0.1.1 for VSIX distribution.

### Python backend (aihydro-tools v1.1.0)
- RAG system removed; `query_hydro_concepts` tool removed.
- Hardcoded "17 tools" references replaced with generic language throughout.
- RAG files archived to `github.com/AI-Hydro/aihydro-rag`.

---

## [0.1.0] — 2026-03-31

### Added
- Initial public release of AI-Hydro VS Code extension.
- Full TypeScript rebranding from Cline → AI-Hydro:
  - Types: `ClineMessage` → `AiHydroMessage`, `ClineAsk` → `AiHydroAsk`, etc.
  - Config files: `.clinerules` / `.aihydroignore` / `.aihydrorules`
  - VS Code config keys: `cline.*` → `aihydro.*`
  - 25 source files renamed, 8 webview files renamed
- Auto-registration of `ai-hydro` MCP server on extension activation
  (`src/core/mcp/ensureDefaultMcpServer.ts`): detects `aihydro-mcp` on PATH
  and writes server config automatically.
- MCP settings file: `aihydro_mcp_settings.json`
  (at `~/Library/Application Support/Code/User/globalStorage/aihydro.ai-hydro/`)
- Custom agent system prompt for hydrological research workflows.
- Python backend: aihydro-tools v1.1.0 (16 MCP tools via `aihydro-mcp`).
- Latest AI model support added to `src/shared/api.ts`:
  Claude 4.6 (Opus/Sonnet), GPT-5.4, Gemini 3.1, and others.
- Documentation: `PLUGIN_GUIDE.md`, `docs/tools-reference.md`,
  `docs/installation.md`, `docs/architecture.md`.
- Community contribution guide: `python/CONTRIBUTING.md`.

### Notes
- Proto/generated code preserved from upstream Cline (untouched):
  `src/shared/proto/cline/`, `src/generated/`, `proto/`
- Proto-conversion layer bridges `AiHydroMessage` (app) ↔ `ClineMessage` (proto)

---

[Unreleased]: https://github.com/AI-Hydro/AI-Hydro/compare/v0.1.8...HEAD
[0.1.8]: https://github.com/AI-Hydro/AI-Hydro/compare/v0.1.7...v0.1.8
[0.1.7]: https://github.com/AI-Hydro/AI-Hydro/compare/v0.1.6...v0.1.7
[0.1.6]: https://github.com/AI-Hydro/AI-Hydro/compare/v0.1.5...v0.1.6
[0.1.5]: https://github.com/AI-Hydro/AI-Hydro/compare/v0.1.4...v0.1.5
[0.1.4]: https://github.com/AI-Hydro/AI-Hydro/compare/v0.1.3...v0.1.4
[0.1.3]: https://github.com/AI-Hydro/AI-Hydro/compare/v0.1.2...v0.1.3
[0.1.2]: https://github.com/AI-Hydro/AI-Hydro/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/AI-Hydro/AI-Hydro/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/AI-Hydro/AI-Hydro/releases/tag/v0.1.0
