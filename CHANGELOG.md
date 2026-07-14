# Changelog — AI-Hydro VS Code Extension

All notable changes to the AI-Hydro VS Code extension are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).
Versioning follows [Semantic Versioning](https://semver.org/).

The companion Python package (`aihydro-tools`) has its own changelog at
`github.com/AI-Hydro/aihydro-tools/CHANGELOG.md`.

---

## [Unreleased]

---

## [0.2.6] — 2026-07-09

### Fixed — Security findings from the extension audit

Nine findings from a focused security + product audit of the extension
(`audits/extension-audit-2026-07-09.md`, ecosystem root) were closed:

- **Dependency vulnerabilities**: `npm audit fix` (79 → 27 vulns); removed
  two OpenTelemetry packages (`exporter-prometheus`, `sdk-node`) that were
  the last remaining high-severity issues after confirming they were
  imported nowhere in the codebase. Production dependency tree is now at
  22 vulnerabilities, all moderate, zero high/critical. CI now hard-gates
  on `npm audit --omit=dev --audit-level=high`.
- **Marketplace download integrity**: module/course installs now validate
  `downloadUrl`/`manifestUrl` against an allowlist of the configured
  marketplace origins before fetching, instead of trusting any URL the
  remote index returns.
- **HTML preview iframe**: narrowed the Content-Security-Policy
  `connect-src` from an unrestricted `https:` to the specific CDN/tile
  origins already trusted for scripts and tiles, closing an exfiltration
  channel for data rendered into preview artifacts.
- **Artifact kernel**: the Python subprocess backing HTML Preview cells no
  longer inherits the full host environment — secret-shaped variables
  (API keys, tokens, cloud credentials) are scrubbed before spawn, matching
  the hardening already applied on the Python `run_python` MCP tool.
- **GEE tile proxy**: now allowlists the tile-template host to
  `earthengine.googleapis.com` and reflects the CORS origin only for
  `vscode-webview://*` callers instead of a wildcard `*`.
- **Local command IPC**: the file-based command channel used by MCP tools
  to drive the Map and HTML Preview panels now validates every command
  against a schema before dispatch.
- **Privacy documentation**: added `PRIVACY.md` describing exactly what
  telemetry is collected by default (PostHog, opt-out via Settings), what's
  opt-in only (OpenTelemetry), and what isn't telemetry at all (Firebase is
  the auth backend). Removed the unused `@sentry/browser` dependency.
- **Accessibility**: re-enabled Biome's `a11y` rule set for AI-Hydro-authored
  components (map, HTML preview, connectors, skills panels) — found zero
  violations.
- Removed a stray, broken demo script at the repo root that was silently
  breaking Python test collection.

See `audits/STATUS.md` (ecosystem root) for the full finding-by-finding
evidence trail.

---

## [0.2.5] — 2026-05-30

### Fixed — Ghost file-ID session entries

Eliminated the last source of duplicate / stale entries in `preview_list_modules`.
Events fired before `manifest.loaded` (e.g. cell-status updates on module open) were
written to disk under the VS Code internal file ID (`file_ef26b9af…`). Once
`manifest.loaded` fired, a second correctly-named file was also written, leaving
both on disk. Three-layer permanent fix:

1. **Retroactive cleanup** — when `manifest.loaded` establishes the `fileId → moduleId`
   mapping, any file-ID disk entry written earlier is immediately deleted.
2. **Removal-time cleanup** — `removeHtmlPreview(id)` now resolves VS Code file IDs to
   manifest module IDs via a pluggable `registerModuleIdResolver()` callback (registered
   by `VscodeHtmlPreviewProvider.initialize()`) and clears both the module-ID session and
   any leftover file-ID disk files when a tab is closed.
3. **`cleanupDiskFiles(id)`** extracted from `clearModule()` for reuse in both paths.

---

## [0.2.4] — 2026-05-30

### Fixed — Manim namespace pollution (root cause of "produced no MP4")

`from manim import *` injects 6 framework `Scene` subclasses (`MovingCameraScene`,
`ThreeDScene`, `VectorScene`, `ZoomedScene`, …) into the cell namespace. The renderer
was iterating every `Scene` subclass and calling `.render()` on `MovingCameraScene`
first — it has no `construct()`, emits no frames, and the render finished with an empty
media directory before the user's scene was ever attempted. Fixed by filtering on
`obj.__module__ == namespace["__name__"]` — only classes *defined in the executed cell*
are rendered. Also:

- Each Scene now renders into its own fresh `tempfile.TemporaryDirectory()` to avoid
  cross-scene glob collisions.
- Final MP4 is chosen by preferring candidates outside `partial_movie_files/` so the
  assembled movie, not an intermediate chunk, is returned.

### Fixed — Session-file accumulation (permanent)

`~/.aihydro/preview_session/` and `~/.aihydro/preview_events/` are ephemeral live-state
directories but were never cleaned, causing unlimited growth and stale cross-session
entries. Fixed:

- `PreviewSessionService` now purges both directories in its constructor — every VS Code
  launch starts with a clean slate.
- `clearAll()` added (called by "Clear all previews") wipes both in-memory and on-disk
  state instantly.
- `clearModule()` refactored to call the shared `cleanupDiskFiles()` helper.

---

## [0.2.3] — 2026-05-30

### Fixed — `preview_list_modules` returning VS Code file IDs

`preview_list_modules()` was listing entries like `file_0155f6f2094bdd2f` instead of
`terrain-to-wetness-twi`. Root cause: the webview reports `item.id` (the VS Code
artifact registry ID) as `moduleId` for every event. `PreviewSessionService` was writing
session files under that opaque ID. Fixed with a `fileIdToModuleId: Map<string, string>`
in `VscodeHtmlPreviewProvider`. The first `manifest.loaded` event carries the manifest's
canonical `id`; subsequent events for the same panel are resolved through the map before
`appendEvent` is called.

### Fixed — Manim `FileNotFoundError: movie_file_path`

`scene.renderer.file_writer.movie_file_path` is unreliable across Manim CE versions and
can point to a path that differs from where the file actually landed. Fixed by globbing
the temp dir for `*.mp4` after render and falling back to `movie_file_path` only when
glob finds nothing.

---

## [0.2.2] — 2026-05-30

### Added — Unified Learners' Hub (HTML Preview Phases 1–4)

A comprehensive upgrade to the HTML Preview panel turning it into a polished
"learners' hub": tighter first-run UX, a reusable interactivity block layer,
Manim video cells, 3D/manipulable simulations, deterministic module validation,
and a live agent↔preview session bridge.

#### Phase 1 — Foundations

- **Quiz → course-progress wiring** — `.aihydro-quiz` radio blocks now post
  `aihydro-quiz-complete` on pass; the host wires this to `courseProgress.markComplete()`.
  `aihydro.quiz()` is a back-compat alias that normalises legacy `aihydro-question` markup.
  Completion % now surfaces in `CourseNavigator` and `CourseHeader`.
- **Kernel pre-warm** — kernel session starts and pre-imports numpy/matplotlib as soon as
  a module opens, so the first cell executes without a cold-start delay. Per-cell status
  cycles through `queued → warming → running → done/error` (animated stripe + status pill).
- **Control-state persistence** — `bindParam` values are persisted to
  `~/.aihydro/module_state/<key>.json`. Module reloads restore saved state. Toolbar kebab
  menu adds **Reset controls to defaults** and **Copy control state**.
- **`AI-Hydro: Validate Module` command** — `validateModule.ts` encodes the
  `interactive-module-builder` 50-item checklist as code: manifest, cell IDs/languages,
  Python cell anti-patterns, CDN version pinning, sim/scene3d canvas wiring, Manim Scene
  subclass presence. Advisory findings listed by error code; integrated into the skill's
  pre-publication step.

#### Phase 2 — Interactivity primitives

All primitives injected into `window.aihydro` via the cell bridge; pure DOM, no kernel
dependency, `prefers-reduced-motion` aware:

- **`aihydro.timeline()`** — play/pause/step/scrub control over N animation frames;
  drives `bindParam` slots or custom `onTick` callbacks.
- **`aihydro.compare(selector)`** — before/after wipe slider over an `.aihydro-compare`
  block (first child = before, second = after).
- **`aihydro.sim({ canvas, step, params })`** — `requestAnimationFrame` loop over a
  `<canvas data-aihydro-sim>` for real-time hydrology simulations (e.g. rain → hydrograph).
- **`aihydro.plot({ mount, data, layout })`** — branded Plotly wrapper; lazy-loads
  Plotly from the CSP-whitelisted CDN and applies the AI-Hydro dark palette.

#### Phase 3 — Manim video cells

- `data-aihydro-render="video"` (or `data-language="manim"`) on a `.aihydro-cell` marks it
  as a video cell.
- Kernel renders each user-defined `Scene` to a low-quality MP4, returns it as
  `video/mp4` base64 output. Bridge plays it inline in `<video controls>`.
- Graceful degradation when Manim/ffmpeg absent — rest of module still works.
- `media-src` directive added to CSP (`buildPreviewCsp.ts`).

#### Phase 4 — 3D / manipulable simulations

- **`aihydro.scene3d({ canvas, dem, setup, onFrame })`** — three.js helper for terrain
  flythroughs, 3D DEM/TWI surfaces, watershed views. Lazy-loads three.js **r128** (pinned
  UMD release) from the CSP-whitelisted jsdelivr CDN. `setup(ctx)` receives a branded
  `{ THREE, scene, camera, renderer, controls, canvas, dem }` context; `onFrame(ctx)` runs
  per animation frame. Reduced-motion renders a single static frame.

#### Skill + exemplars

- `interactive-module-builder` skill bumped to v0.3.0: added INTERACTIVITY PRIMITIVES
  section (decision matrix, exact API contracts, anti-patterns), MANIM VIDEO CELLS
  section, pre-publish checklist lines for all new primitives.
- Recipe cookbook added (`assets/recipes/`): one verified, pinned snippet per primitive.
- Three gold-standard exemplar modules published:
  - **master-recession-curve** — timeline + sim + bindParam
  - **flow-duration-curve** — Plotly + compare + bindParam
  - **terrain-to-wetness-twi** — scene3d + compare + Manim video

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
