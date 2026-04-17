# Changelog

All notable changes to the AI-Hydro VS Code extension are documented here.
The companion Python package (`aihydro-tools`) has its own changelog at
[github.com/AI-Hydro/aihydro-tools](https://github.com/AI-Hydro/aihydro-tools/blob/main/CHANGELOG.md).

---

## [0.1.5] — 2026-04-16

### Platform vision
- **LLM interpretation layer** — `research.md` now has two sections: a Python-generated structural skeleton (always current) and an LLM-authored scientific context section written by the foundation model via `sync_research_context`. Deleted all template-based Python interpretation logic (`_key_findings()`, "suggested next step").
- **`sync_research_context` redesigned** — now a two-phase tool: Phase 1 returns all raw session data for LLM reasoning; Phase 2 accepts `interpretation` (scientific prose) and `site_name` (descriptive slug) and embeds them permanently in `research.md`.
- **`site_name` field** — sessions now carry a human-readable display name set by the LLM, separate from the raw gauge ID.
- **`raw_session_data()` method** — `HydroSession` now exposes all computed slot values as a flat dict for LLM consumption — every key from every slot, not a 3-key template.

### Analysis improvements
- **PNG diagnostic outputs** — three new tools now save publication-quality figures automatically when `workspace_dir` is set: watershed boundary map (`delineate_watershed`), daily hydrograph with 30-day rolling mean (`fetch_streamflow_data`), log-scale flow duration curve with signature table (`extract_hydrological_signatures`).
- **New `analysis/plots.py` module** — headless matplotlib plots using Agg backend; `@_mpl_required` decorator silently skips if matplotlib unavailable.
- **`extract_camels_attributes` removed** — the incomplete per-site attribute extractor has been dropped. CAMELS-US data continues to be used internally by `train_hydro_model` for the 671 benchmark gauges. A dedicated `camels-attrs` MCP server will be released as a community plugin.

### Session architecture
- **Lean session JSON** — watershed GeoJSON geometry is no longer stored inline in the session JSON (was 200–800 KB per gauge). Stored at `~/.aihydro/sessions/<gauge_id>.geojson`; session stores only the path. `_get_session_geometry()` reads from file transparently.
- **`_get_session_geometry()` hardened** — tries `geometry_geojson_path` (new), then `geometry_geojson`, `geometry`, `geojson` (legacy fallback). Clear recovery instructions on failure.
- **Project workspace auto-detection** — `ProjectSession.save()` now finds `workspace_dir` from any associated gauge session automatically; project `research.md` writes to the correct workspace instead of repo root.

### Fixed
- Timedelta warning from pygridmet downgraded from `log.error` to `log.warning` with pandas 2.x explanation — not a failure, NaN fallback is correct behaviour.
- TWI visualization: static map and interactive map now in separate `try/except` blocks — a failed interactive map no longer suppresses the static PNG.
- `print()` calls in TWI visualization paths replaced with `log.warning()` (invisible in MCP context).

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
