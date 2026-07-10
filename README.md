# AI-Hydro

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="./assets/docs/aihydro-hero-animated.svg" />
    <source media="(prefers-color-scheme: light)" srcset="./assets/docs/aihydro-hero-animated.svg" />
    <img src="./assets/docs/aihydro-hero-static.png" alt="AI-Hydro — Intelligent Hydrological Computing" width="100%" />
  </picture>
</p>

<p align="center">
  <em>An open platform for autonomous hydrological and earth science research.</em>
</p>

<p align="center">
  <a href="https://marketplace.visualstudio.com/items?itemName=aihydro.ai-hydro"><img src="https://img.shields.io/visual-studio-marketplace/v/aihydro.ai-hydro?label=VS%20Code%20Marketplace&color=0078d7" alt="Marketplace" /></a>
  <a href="https://pypi.org/project/aihydro-tools/"><img src="https://img.shields.io/pypi/v/aihydro-tools?color=3775a9" alt="PyPI" /></a>
  <a href="https://github.com/AI-Hydro/AI-Hydro/releases"><img src="https://img.shields.io/github/v/release/AI-Hydro/AI-Hydro?label=release&color=blue" alt="Release" /></a>
  <a href="https://doi.org/10.5281/zenodo.19597664"><img src="https://img.shields.io/badge/DOI-10.5281%2Fzenodo.19597664-blue" alt="DOI" /></a>
  <a href="./LICENSE"><img src="https://img.shields.io/badge/license-Apache%202.0-green" alt="License" /></a>
  <a href="https://www.python.org/"><img src="https://img.shields.io/badge/python-3.10%2B-blue" alt="Python" /></a>
</p>

<p align="center">
  <a href="https://ai-hydro.github.io/AI-Hydro/"><strong>Documentation</strong></a> &middot;
  <a href="https://github.com/AI-Hydro/AI-Hydro"><strong>GitHub</strong></a> &middot;
  <a href="https://pypi.org/project/aihydro-tools/"><strong>PyPI</strong></a> &middot;
  <a href="https://ai-hydro.github.io/AI-Hydro/getting-started/quickstart/"><strong>Quick Start</strong></a> &middot;
  <a href="https://ai-hydro.github.io/AI-Hydro/tools/"><strong>Tools Reference</strong></a> ·
  <a href="https://www.youtube.com/channel/UC8RWDhJm61i2tlV9mt982cw"><strong>YouTube</strong></a> ·
  <a href="https://x.com/aihydro"><strong>X / Twitter</strong></a> ·
  <a href="https://github.com/AI-Hydro/AI-Hydro/issues"><strong>Issues</strong></a>
</p>

<p align="center">
  <a href="https://www.youtube.com/watch?v=8YEQmEkid90">
    ▶&nbsp;&nbsp;<strong>Watch the intro — What if an AI Agent Could Run Your Entire Hydrology Study?</strong>
  </a>
</p>

---

> **Built on [Cline](https://github.com/cline/cline)'s proven agent loop** (Apache 2.0), specialized for hydrology and earth science research. The agent core is Cline; the domain layer — tools, session memory, provenance, and the Python backend — is AI-Hydro.

---

## The Vision

Hydrological research today involves a fragmented cycle: downloading data from scattered federal APIs, wrangling formats, writing processing scripts, calibrating models, and documenting provenance — often spending more time on plumbing than on science. As foundation models become increasingly capable at reasoning over scientific problems, there is an opportunity to fundamentally change how computational hydrology is done.

**AI-Hydro** is a platform that bridges this gap. It puts foundation models (Claude, GPT-4, Gemini, and others) at the centre of the research workflow and gives them direct access to production-quality hydrological and geospatial tools — not as a chatbot that generates code you then debug, but as an intelligent agent that orchestrates real computations, remembers context across sessions, and adapts its approach when built-in tools fall short by writing standalone scripts leveraging the latest scientific Python ecosystem.

The platform ships with a growing set of **built-in tools** — from USGS watershed delineation to differentiable HBV-light calibration — but the long-term vision is much larger: **a community-driven ecosystem** where researchers contribute domain-specific tools (flood frequency analysis, sediment transport, groundwater modelling, remote sensing workflows) that any AI agent can discover and compose into novel research pipelines. Through a simple plugin system, any Python package can register tools that become immediately available to every AI-Hydro user.

This is what the future of computational hydrology and geospatial sciences looks like: researchers describe their intent, and intelligent agents assemble the right data, methods, and models to get it done.

---

## What AI-Hydro Can Do

### 1. Automated Research via Built-in Tools

When a tool exists for the task, the AI calls it directly — no code generation, no copy-paste, no debugging. Results come back structured and cached.

```
You: "Delineate the watershed for USGS gauge 01031500, fetch 10 years of
     GridMET forcing, and calibrate a differentiable HBV model."

AI-Hydro: [calls delineate_watershed -> fetch_forcing_data -> train_hydro_model]
          Watershed: 769 km², Piscataquis River ME
          HBV calibration complete: NSE = 0.638, KGE = 0.644
```

The AI chains multiple tools in a single conversation — delineation, data retrieval, signature extraction, model calibration — building on each step's results.

### 2. Standalone Script Generation When Tools Don't Exist

AI-Hydro isn't limited to its built-in tools. When the task requires something outside the current toolkit — a custom statistical analysis, a novel visualisation, a niche data format conversion — the AI writes and executes standalone Python scripts, leveraging the full scientific Python ecosystem (NumPy, SciPy, xarray, rasterio, PyTorch, and beyond).

```
You: "Run a Mann-Kendall trend test on the annual peak flows and plot the
     results with a Sen's slope overlay."

AI-Hydro: [writes and runs a standalone script using pymannkendall + matplotlib]
          Mann-Kendall p = 0.023 (significant), Sen's slope = -1.2 m³/s per year
          Plot saved to session.
```

This dual capability — structured tools for common tasks, freeform scripting for everything else — means AI-Hydro adapts to the full breadth of research needs.

### 3. Community-Extensible Tool Ecosystem

AI-Hydro is designed as a **platform**, not a closed product. Any researcher can package domain-specific tools and make them available to the entire community:

```toml
# In your package's pyproject.toml
[project.entry-points."aihydro.tools"]
flood_frequency = "my_package.tools:flood_freq_tool"
sediment_yield  = "my_package.tools:sediment_tool"
```

Install the package, restart the server, and those tools are immediately available to every AI model connected to AI-Hydro. We envision a growing ecosystem of community-contributed tools spanning:

- Flood frequency and extreme event analysis
- Groundwater modelling and well analysis
- Water quality and nutrient cycling
- Snow hydrology and glaciology
- Hydraulic modelling and flood mapping
- Remote sensing-derived hydrology workflows

See the [Plugin Guide](https://ai-hydro.github.io/AI-Hydro/plugins/overview/) to contribute a tool or knowledge plugin, or go directly to the [Contributing Guide](https://ai-hydro.github.io/AI-Hydro/contributing/) for the full contribution workflow.

---

## Built-in Tools

| Category | Tools |
|---|---|
| **Watershed** | `delineate_watershed`, `delineate_watershed_from_point` — NHDPlus delineation from USGS NLDI |
| **Streamflow** | `fetch_streamflow_data` — USGS NWIS daily discharge |
| **Baseflow** | `separate_baseflow` — Lyne-Hollick + Eckhardt recursive filters with BFI interpretation |
| **Signatures** | `extract_hydrological_signatures` — 15+ flow statistics (BFI, runoff ratio, FDC slopes, flashiness) |
| **Geomorphic** | `extract_geomorphic_parameters` — 28 basin morphometry metrics |
| **Terrain** | `compute_twi` — Topographic Wetness Index from 3DEP DEM |
| **Curve Number** | `create_cn_grid` — NRCS CN grid from NLCD land cover + Polaris soils |
| **Forcing** | `fetch_forcing_data` — GridMET basin-averaged climate (prcp, tmax, tmin, PET, srad, wind) |
| **CAMELS** | `fetch_camels_us` — Full CAMELS-US attribute set (671 CONUS gauges) via pygeohydro |
| **Modelling** | `train_hydro_model` — Differentiable HBV-light or NeuralHydrology LSTM |
| **Modelling** | `get_model_results`, `get_training_status` — Results and training progress |
| **Map** | `show_on_map`, `map_update_layer`, `map_apply_symbology`, `map_get_state`, `map_set_basemap` |
| **HTML Preview** | `show_html_preview` — Open HTML artifacts in the built-in kernel panel |
| **GEE** | `gee.status`, `gee.preview_layer`, `gee.extract_timeseries` — Google Earth Engine integration |
| **Skills** | `list_skills`, `load_skill`, `save_skill` — Workflow playbook discovery and management |
| **Provenance** | `add_claim`, `add_assumption`, `check_water_balance_consistency`, `check_temporal_alignment` |
| **Session** | `start_session`, `get_session_summary`, `export_session`, `merge_session_shards`, `sync_research_context` |
| **Project** | `start_project`, `get_project_summary`, `add_session_to_project` |
| **Literature** | `index_literature`, `search_literature`, `add_journal_entry`, `log_researcher_observation` |
| **Discovery** | `list_available_tools`, `get_variable_definition`, `get_metric_definition`, `get_library_reference` |

**50+ built-in tools.** Call `list_available_tools()` for the live count on your installation. See the [Tools Reference](https://ai-hydro.github.io/AI-Hydro/tools/) for full parameters, examples, and return schemas.

---

## Key Capabilities

### Research Session Memory

Every tool result is cached in a **HydroSession** (JSON per gauge). Expensive computations — watershed delineation (~10s), multi-year streamflow downloads (~5s) — are done once and reused across conversations, days, or weeks. The session tracks provenance so you can export a methods paragraph for your paper.

```
Session 01031500  [updated 2026-03-06]
  Computed (7): watershed, streamflow, signatures, geomorphic, camels, forcing, model
  Pending  (1): twi

  Watershed area:    769.0 km²  (HUC-02: 01)
  Streamflow record: 3,652 days
  Baseflow index:    0.61
  HBV differentiable: NSE=0.638, KGE=0.644
```

### Differentiable HBV-Light

A pure-PyTorch differentiable HBV-light is built in:

- 12 physically-meaningful calibrated parameters
- Multi-restart Adam optimiser with cosine annealing
- Automatic CAMELS streamflow via `pygeohydro` for 671 CONUS gauges
- Typical performance: NSE 0.55-0.80

### Interactive Map Panel

Every analysis result appears on a live map inside VS Code — no external GIS tool needed.

- **Auto-push from tools** — `delineate_watershed` pushes the catchment polygon and gauge point automatically; `compute_twi` and `create_cn_grid` push colour-mapped raster tiles
- **8 file formats** — drag any GeoJSON, KML, KMZ, GPX, Shapefile (.zip), GeoTIFF, TopoJSON, or CSV onto the map to load it instantly
- **Agent layer control** — the agent can update colours, opacity, class breaks, and choropleth symbology on existing layers via `map_update_layer` and `map_apply_symbology`, without duplicating files
- **Symbology editor** — per-layer fill/stroke/opacity and colormap controls inline in the layer panel
- **13 free basemaps** — USGS Imagery, USGS Topo, Esri Hillshade, Esri Ocean, Carto, Stadia, and more; no API token required
- **Persistent workspace** — basemap, view state, and layer visibility are saved across VS Code sessions

### HTML Preview — Built-in Python Kernel

A Jupyter-like execution environment embedded directly in VS Code, purpose-built for AI-generated interactive artifacts.

- **Executable Python cells** — click Run ▶ to execute cells; kernel state persists across runs
- **Auto-open** — any HTML file containing the AI-Hydro module manifest opens automatically when the agent writes it
- **Interactive learning modules** — the `interactive-module-builder` skill produces fully-branded modules with prose, Python cells, JS visualisations, quizzes, peer-reviewed citations, and provenance footers
- **Animated kernel status chip** — colour-coded pill shows Ready (green) / Busy (pulsing blue) / Dirty (amber + ✎) / Error (red) at a glance
- **Per-artifact kernel isolation** — each module gets its own kernel session; variables do not leak between artifacts

### Skills — Workflow Playbooks

The agent discovers and follows domain-specific workflow playbooks before planning any multi-step task.

- **Mandatory pre-flight** — before creating any artifact or running a multi-step analysis, the agent calls `list_skills()` and loads the matching skill
- **Marketplace** — browse and install community-contributed skills from `github.com/AI-Hydro/Skills` in the VS Code Skills panel
- **Agent-created** — after novel workflows, the agent saves new skills automatically via `save_skill()`
- **Governing contracts** — skills encode exact format requirements, checklist gates, and quality standards the agent must follow

Built-in marketplace skills: `interactive-module-builder`, `baseflow-separation`, `flood-frequency-analysis`, `watershed-characterisation`, `hydro-visualization`.

### Connectors — External Data Sources

Authenticated links to external data services, managed through the VS Code Connectors panel.

- **Google Earth Engine (live)** — OAuth-authenticated access to the GEE public catalog; extract NDVI, ET, precipitation, and any other band over your study area; render layers on the Map panel via `gee.preview_layer`
- **Coming soon** — HAWQS (SWAT simulations), HydroShare (community datasets + publishing), Planetary Computer (Landsat/Sentinel archive), OpenTopography (lidar DEMs), NASA Earthdata (MODIS, GPM, SMAP)
- **Secure credential storage** — credentials encrypted in VS Code secret storage; never written to plain-text config files

### Model Context Protocol (MCP)

All tools communicate via the [Model Context Protocol](https://modelcontextprotocol.io/) — an open standard for connecting AI models to external capabilities. This means AI-Hydro tools work with any MCP-compatible client, not just the bundled extension.

### Works with Any AI Provider

| Provider           | Recommended model            |
| ------------------ | ---------------------------- |
| Anthropic          | Claude Sonnet 4.6 / Opus 4.6 |
| OpenAI             | GPT-5.4                      |
| Google             | Gemini 3.1 Pro / 2.5 Flash   |
| AWS Bedrock        | Claude on Bedrock            |
| Ollama / LM Studio | Local models                 |

---

## Installation
```bash
pip install aihydro-tools[all]
```

This installs all hydrological tools and the `aihydro-mcp` server command. The extension auto-detects it on startup.

<details>
<summary>Optional extras (install only what you need)</summary>

```bash
pip install aihydro-tools[data]       # streamflow, forcing, land cover, soil, CAMELS
pip install aihydro-tools[analysis]   # watershed, signatures, TWI, geomorphic, CN
pip install aihydro-tools[modelling]  # PyTorch HBV-light, NeuralHydrology LSTM
pip install aihydro-tools[viz]        # matplotlib, plotly, folium
```

</details>

### Step 2 — Install the VS Code Extension

**Option A — VS Code Marketplace**

Search for **"AI-Hydro"** in VS Code Extensions, or install from the [Marketplace page](https://marketplace.visualstudio.com/items?itemName=aihydro.ai-hydro).

**Option B — Install from `.vsix`**

1. Download the latest `.vsix` from [Releases](https://github.com/AI-Hydro/AI-Hydro/releases)
2. In VS Code: `Extensions` > `...` > `Install from VSIX...`

**Option C — Build from source**

```bash
git clone https://github.com/AI-Hydro/AI-Hydro.git
cd AI-Hydro
npm run install:all
npm run package          # produces ai-hydro-*.vsix
```

### Step 3 — Configure Your AI Provider

1. Click the **AI-Hydro icon** in the VS Code sidebar
2. Open **Settings** (gear icon)
3. Select your provider and enter your API key
4. Click **Save**

### Step 4 — Verify

```bash
aihydro-mcp  # should start and list all registered tools
```

The extension auto-registers the MCP server on startup. If you need manual registration:

```bash
python setup_mcp.py --ide vscode
python setup_mcp.py --ide claude-code   # for Claude Code CLI
```

---

## Privacy

See [PRIVACY.md](PRIVACY.md) for exactly what telemetry is collected by
default, what's opt-in only, and how to turn it off.
