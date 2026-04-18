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

| Category               | Tools                                                                                                                      |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| **Watershed**    | `delineate_watershed` — NHDPlus delineation from USGS NLDI                                                              |
| **Streamflow**   | `fetch_streamflow_data` — USGS NWIS daily discharge                                                                     |
| **Signatures**   | `extract_hydrological_signatures` — 15+ flow stats (BFI, runoff ratio, FDC)                                             |
| **Geomorphic**   | `extract_geomorphic_parameters` — 28 basin morphometry metrics                                                          |
| **Terrain**      | `compute_twi` — Topographic Wetness Index from 3DEP DEM                                                                 |
| **Curve Number** | `create_cn_grid` — NRCS CN grid from NLCD land cover + Polaris soils                                                    |
| **Forcing**      | `fetch_forcing_data` — GridMET basin-averaged climate (prcp, tmax, tmin, PET, srad, wind)                               |
| **CAMELS**       | `fetch_camels_us` — Full CAMELS-US attribute set (671 CONUS gauges) via pygeohydro                                      |
| **Modelling**    | `train_hydro_model` — Differentiable HBV-light or NeuralHydrology LSTM                                                  |
| **Modelling**    | `get_model_results` — Retrieve cached NSE / KGE / RMSE                                                                  |
| **Session**      | `start_session`, `get_session_summary`, `clear_session`, `add_note`, `export_session`, `sync_research_context` |

See the [Tools Reference](https://ai-hydro.github.io/AI-Hydro/tools/) for full parameters, examples, and return schemas.

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

### Prerequisites

- VS Code 1.84+
- Python 3.10+ (Miniconda or system)
- An API key for at least one AI provider

### Step 1 — Install the Python Tools

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

See the [Installation Guide](https://ai-hydro.github.io/AI-Hydro/getting-started/installation/) for detailed platform-specific instructions.

---

## Quick Start

Once installed, open the AI-Hydro chat panel and try:

```
Start a research session for USGS gauge 01031500 and delineate its watershed.
```

Then continue naturally:

```
Fetch 10 years of GridMET forcing data and extract hydrological signatures.
```

```
Train a differentiable HBV model and show me the performance metrics.
```

```
Export the full session methods paragraph for my paper.
```

See the [Quick Start guide](https://ai-hydro.github.io/AI-Hydro/getting-started/quickstart/) for a complete walkthrough.

---

## Architecture

```
+------------------------------------------------------+
|  VS Code Extension  (TypeScript / React)              |
|   Chat · Settings · Map · File editing · Terminal      |
+---------------------------+--------------------------+
                            |
              Model Context Protocol (stdio)
                            |
              +-------------+-------------+
              |                           |
              v                           v
+---------------------------+  +---------------------+
| Built-in MCP Tools        |  | Standalone Scripts   |
| aihydro-tools on PyPI     |  | AI writes & executes |
| + Community plugin tools  |  | full Python ecosystem |
+-------+--------+----+----+  +---------------------+
        |        |    |
   USGS NWIS  GridMET  pygeohydro
   NHDPlus    3DEP     CAMELS
   NLDI       MODIS    PyTorch HBV
```

The extension acts as an MCP **client**: when the AI decides to call `delineate_watershed`, it sends a JSON-RPC request to the Python server, which fetches real data from USGS/GridMET/etc. and returns structured results. When no tool exists for the task, the AI writes a standalone Python script and executes it through the integrated terminal — combining the reliability of structured tools with the flexibility of general-purpose programming.

Full architecture details: [Architecture](https://ai-hydro.github.io/AI-Hydro/architecture/)

---

## Documentation

| Document                                          | Description                            |
| ------------------------------------------------- | -------------------------------------- |
| [Installation Guide](https://ai-hydro.github.io/AI-Hydro/getting-started/installation/) | Platform-specific install guide |
| [Quick Start](https://ai-hydro.github.io/AI-Hydro/getting-started/quickstart/) | First research session walkthrough |
| [Tools Reference](https://ai-hydro.github.io/AI-Hydro/tools/) | All tools with parameters and examples |
| [Architecture](https://ai-hydro.github.io/AI-Hydro/architecture/) | System design and data flow |
| [Contributing](https://ai-hydro.github.io/AI-Hydro/contributing/) | How to contribute |

---

## Contributing Tools

We welcome contributions from the hydrology and geospatial sciences community. There are three practical contribution tracks, grouped into two implementation routes:

**Path A: Standalone MCP Server** — Build an independent MCP server for a full sub-domain toolkit (flood frequency analysis, hydraulic modelling, etc.). Your server runs as its own process with its own dependencies and gets registered alongside the core `ai-hydro` server. Best for complex toolkits or when you need full dependency isolation.

**Paths B/C: Entry-Point & Knowledge Plugins** — Extend the existing `aihydro-tools` server by registering Python entry points. Path B adds executable tool functions with full HydroSession access; Path C adds knowledge/reference cards that help agents use external scientific libraries correctly. Best for single tools, lightweight extensions, and library-specific guidance.

```toml
# Path B — just add this to your pyproject.toml
[project.entry-points."aihydro.tools"]
my_tool = "my_package.tools:my_tool_function"
```

Install, restart the server, and your tool is immediately available to every AI model.

See **[Plugin Guide](https://ai-hydro.github.io/AI-Hydro/plugins/overview/)** for complete walkthroughs of all three plugin paths, including the data contract, session integration, and testing.

### Priority Contribution Areas

We are especially interested in contributions that fit the current platform architecture cleanly and can be exposed as reliable, reproducible tools:

- Flood frequency analysis and extreme event statistics
- Groundwater modelling, well analysis, and recharge estimation
- Water quality and nutrient cycling
- Snow hydrology and glaciology
- Hydraulic modelling and 2D flood mapping
- Remote sensing-derived hydrology workflows

Knowledge-plugin contributions are also highly valuable for libraries such as `swmmio`, `hecras`, `nlmod`, `oggm`, `snowpack`, and `pywr`.

See the [Contributing Guide](https://ai-hydro.github.io/AI-Hydro/contributing/) for the step-by-step tool and knowledge-plugin workflow, or open an [issue](https://github.com/AI-Hydro/AI-Hydro/issues) if you want to discuss a contribution idea before implementing it.

---

## Citation

If you use AI-Hydro in your research, please cite:

- Extension DOI: [10.5281/zenodo.19597664](https://doi.org/10.5281/zenodo.19597664)
- Python MCP server DOI: [10.5281/zenodo.19597589](https://doi.org/10.5281/zenodo.19597589)

```bibtex
@software{aihydro_extension_2026,
  title   = {AI-Hydro: An Open Platform for Autonomous Hydrological and
             Earth Science Research},
  author  = {Galib, Mohammad and Merwade, Venkatesh},
  year    = {2026},
  version = {0.1.4},
  doi     = {10.5281/zenodo.19597664},
  url     = {https://doi.org/10.5281/zenodo.19597664}
}
```

For the Python MCP server package, cite:

```bibtex
@software{aihydro_tools_2026,
  title   = {aihydro-tools: An Open Python MCP Server for Autonomous
             Hydrological Research},
  author  = {Galib, Mohammad and Merwade, Venkatesh},
  year    = {2026},
  version = {1.2.1},
  doi     = {10.5281/zenodo.19597589},
  url     = {https://doi.org/10.5281/zenodo.19597589}
}
```

---

## Built on Open Source

AI-Hydro is a domain-specific fork of [Cline](https://github.com/cline/cline) (Apache 2.0). We are grateful to the Cline team for building the agentic VS Code framework that made this possible.

The Python backend builds on the broader scientific Python ecosystem — federal data APIs, geospatial libraries, and deep learning frameworks — all open source and properly cited in the tool provenance metadata.

---

## License

[Apache 2.0](./LICENSE) &copy; 2026 Mohammad Galib

---

## Support

- **Bugs / questions**: [GitHub Issues](https://github.com/AI-Hydro/AI-Hydro/issues)
- **Ideas**: [GitHub Discussions](https://github.com/AI-Hydro/AI-Hydro/discussions)
- **Email**: mgalib@purdue.edu
