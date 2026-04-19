---
description: Frequently asked questions about AI-Hydro — compatibility, data coverage, models, privacy, and extending the platform.
---

# FAQ

---

## Getting Started

### Do I need the VS Code extension to use AI-Hydro?

No. The `aihydro-mcp` server is a standalone process that any MCP-compatible client can connect to. The VS Code extension is one client — but Claude Code CLI, Cursor, and any other tool that supports the Model Context Protocol can use AI-Hydro tools directly.

To register the server with Claude Code CLI:

```bash
cd python && python setup_mcp.py --ide claude-code
```

### Is AI-Hydro free?

The extension and Python package are free and open source (Apache 2.0). You pay only for your AI provider's API usage — AI-Hydro does not add any charges on top. Claude Sonnet via the Anthropic API costs roughly $3/MTok input, $15/MTok output. A typical research session (delineation + signatures + HBV calibration) uses well under 100K tokens.

If you use **Claude Code** at $20/month (Pro) or $100/month (Max), the included usage covers extensive AI-Hydro sessions with no per-token charges.

### How do I verify my installation?

```bash
aihydro-mcp --diagnose
```

This checks module imports, tool registration, and PATH configuration. If `aihydro-mcp` is not on your PATH, use the module fallback:

```bash
python -m ai_hydro.mcp --diagnose
```

---

## Data & Gauge Coverage

### Does AI-Hydro work with non-USGS gauges?

Not with the built-in tools. The analysis tools (`delineate_watershed`, `fetch_streamflow_data`, `extract_hydrological_signatures`, etc.) are built around USGS NWIS gauge IDs and the NHDPlus network. International gauges (GRDC, Environment Canada, etc.) are not currently supported.

For non-USGS data, the AI can write standalone scripts using your local data files — it is not limited to built-in tools. Native international gauge support (GRDC, Global Runoff Database) is planned for v0.3.x.

### Which gauges work with the LSTM model?

The NeuralHydrology LSTM (`framework="neuralhydrology"` in `train_hydro_model`) uses CAMELS static catchment attributes automatically for the **671 CONUS gauges** in the CAMELS-US dataset. Ensure `fetch_streamflow_data` has been called first. For non-CAMELS gauges, LSTM training is possible but static attribute embedding is limited.

The differentiable HBV-light model (`framework="hbv"`) works for any USGS gauge in CONUS — it needs only watershed geometry and GridMET forcing data. For CAMELS-671 gauges, the CAMELS benchmark streamflow record is used automatically as training data.

### What date ranges are available for forcing data?

GridMET forcing data (`fetch_forcing_data`) is available from **1979-01-01 to near-present** (typically updated within 1–2 months of real time). USGS streamflow records vary by gauge — some records go back to the 1890s.

---

## Tools & Features

### Why did `extract_geomorphic_parameters` fail with a dependency error?

The geomorphic tool uses `xrspatial` for slope computation. `xrspatial` is not currently installable on **Python 3.13** due to an upstream packaging issue. If you are on Python 3.13, use Python 3.10–3.12 for the analysis extras, or install via conda:

```bash
conda install -c conda-forge xarray-spatial
```

### Does the `compute_twi` tool work on Python 3.13?

Yes. TWI uses `pysheds` for flow accumulation and slope — it has no dependency on `xrspatial` and works on all supported Python versions (3.10+).

### Can I extract text from scanned PDFs with the literature tools?

Not automatically. `index_literature` requires PDFs with a selectable text layer. Scanned image PDFs (e.g., old journal articles without OCR) will be indexed with empty content. OCR fallback is planned for v0.2.x. In the meantime, tools like `ocrmypdf` can add a text layer before indexing.

### What is the difference between HydroSession, ProjectSession, and ResearcherProfile?

| | Scope | Stored at |
|---|---|---|
| **HydroSession** | One gauge — caches analysis results (watershed, streamflow, signatures, model, etc.) | `~/.aihydro/sessions/<gauge_id>.json` |
| **ProjectSession** | One research project spanning multiple gauges, topics, or datasets | `~/.aihydro/projects/<name>/project.json` |
| **ResearcherProfile** | You — expertise, preferred models, active projects, accumulated observations | `~/.aihydro/researcher.json` |

All three persist across conversations and are injected into the agent's context automatically.

---

## Privacy & Data Storage

### Is my research data sent anywhere?

No. All session data, project files, and researcher profile are stored **locally** at `~/.aihydro/`. Nothing is uploaded to AI-Hydro servers — there are none. The only outbound connections are:

- Your AI provider (Anthropic, OpenAI, Google, etc.) — your prompts and tool results
- Federal data APIs (USGS NWIS, GridMET, 3DEP, etc.) — only when a data tool is called

### Can I use AI-Hydro on an air-gapped or offline machine?

Partially. The MCP server starts without internet, and sessions already computed will be served from cache. Any tool that fetches live data (streamflow, forcing, DEM, etc.) will fail without network access to the federal APIs. Local/offline AI models via Ollama or LM Studio can replace the cloud provider dependency.

---

## Compatibility

### Which Python versions are supported?

Python **3.10, 3.11, 3.12** — fully supported for all extras including geomorphic analysis.
Python **3.13** — core tools work; `extract_geomorphic_parameters` requires a conda-installed `xarray-spatial` (see above).

### Does it work on Windows?

Yes, with one caveat: automatic PATH detection for `aihydro-mcp` on Windows can sometimes fail after `pip install`. If the VS Code extension does not detect the server automatically, run:

```bash
cd python && python setup_mcp.py --ide vscode
```

Or configure the server manually in the extension settings using `python -m ai_hydro.mcp` as the command.

### Can I run AI-Hydro tools without an AI agent — just as a Python library?

Yes. Every tool is a regular Python function. Import and call directly:

```python
from ai_hydro.analysis.watershed import delineate_watershed
from ai_hydro.data.streamflow import fetch_streamflow_data

ws = delineate_watershed("01031500")
sf = fetch_streamflow_data("01031500", start_date="2015-01-01", end_date="2024-12-31")
```

All functions return `HydroResult` objects with `.data` (results dict) and `.meta` (provenance metadata).

---

## Contributing & Extending

### How do I add my own tools?

There are two paths:

- **Entry-point plugin** — register Python functions into the existing `aihydro-tools` process via `[project.entry-points."aihydro.tools"]` in your `pyproject.toml`. Tools get full access to `HydroSession` and cached data. Best for single tools or small extensions.
- **Standalone MCP server** — build an independent server with its own dependencies, registered alongside `ai-hydro`. Best for complex toolkits or when you need full dependency isolation.

See the [Plugin Guide](plugins/overview.md) for complete walkthroughs of both paths.

### Does my plugin need to be published to PyPI?

No. A local editable install (`pip install -e .`) works during development. Publish to PyPI when you want others to use it with `pip install my-plugin`.

---

## Still have a question?

Open an issue at [github.com/AI-Hydro/AI-Hydro/issues](https://github.com/AI-Hydro/AI-Hydro/issues) with the `question` label.
