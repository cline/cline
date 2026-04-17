---
description: AI-Hydro project roadmap — current beta status, known limitations, and planned features for v0.2, v0.3, and v1.0.
---

# Roadmap

!!! tip "Project Status: Beta (v0.1.x)"
    Core APIs are stable. New tools and features are being added regularly.
    Not yet recommended for production pipelines without pinned versions.
    Breaking changes before v1.0 will be documented in the [Changelog](changelog.md).

---

## Current Version — v0.1.4

**Extension:** v0.1.4 · **Python backend:** aihydro-tools v1.2.1

### What's stable
- All 26 built-in MCP tools (analysis, modelling, session, project, literature, persona)
- HydroSession, ProjectSession, ResearcherProfile persistence
- Plugin entry-point system (`aihydro.tools`)
- VS Code extension auto-registration
- GitHub Pages documentation

### Known limitations
- USGS-gauge-centric data tools — non-USGS international gauges require custom scripts
- PDF extraction requires text-layer PDFs (scanned images not supported)
- LSTM modelling requires CAMELS gauges (static attributes dependency)
- `xrspatial` not available on Python 3.13 — `extract_geomorphic_parameters` requires conda-installed `xarray-spatial`; TWI is unaffected (uses `pysheds`)

---

## Near-term — v0.2.x

- [ ] Terminal recording (asciinema/vhs) embedded on home page
- [ ] Screenshot gallery of VS Code extension in action
- [ ] Case study: multi-basin CAMELS comparison with provenance export
- [ ] `search_experiments` natural language improvements
- [ ] Improved PDF extraction (OCR fallback for scanned PDFs)
- [ ] Windows PATH auto-detection improvements in extension

---

## Medium-term — v0.3.x

- [ ] International gauge support (GRDC, Global Runoff Database)
- [ ] Interactive provenance viewer in VS Code sidebar
- [ ] Automated session diff — detect what changed between runs
- [ ] Community plugin registry page (curated list with install commands)
- [ ] `aihydro-rag` optional semantic literature search package

---

## Long-term — v1.0

- [ ] Stable, versioned API contract for plugins
- [ ] Full test suite with live data fixtures
- [ ] Peer-reviewed paper published (GMD or Environmental Modelling & Software)
- [ ] Docker image for reproducible deployment
- [ ] CI integration — run AI-Hydro analyses as part of research CI pipelines

---

## Contributing to the Roadmap

Have a domain tool or feature you need? [Open an issue](https://github.com/AI-Hydro/AI-Hydro/issues) with the `enhancement` label or contribute directly — see the [Plugin Guide](plugins/overview.md) for the fastest path to adding new domain tools.
