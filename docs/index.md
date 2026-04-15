---
hide:
  - toc
---

<div class="hero" markdown>

# AI-Hydro

<p class="tagline">Intelligent Hydrological Computing</p>

<div class="install-block">pip install aihydro-tools[all]</div>

<p style="color: #94a3b8; font-size: 0.95rem;">
  The first hydrology platform built for reproducibility-first AI research —<br>
  every analysis step automatically recorded, citable, and reusable.
</p>

[Get Started](getting-started/installation.md){ .md-button .md-button--primary }
[View on GitHub](https://github.com/AI-Hydro/AI-Hydro){ .md-button }
[Watch on YouTube](https://www.youtube.com/channel/UC8RWDhJm61i2tlV9mt982cw){ .md-button }

</div>

<p align="center">
  <a href="https://marketplace.visualstudio.com/items?itemName=aihydro.ai-hydro"><img src="https://img.shields.io/visual-studio-marketplace/v/aihydro.ai-hydro?label=VS%20Code%20Marketplace&color=0078d7" alt="Marketplace" /></a>
  &nbsp;
  <a href="https://pypi.org/project/aihydro-tools/"><img src="https://img.shields.io/pypi/v/aihydro-tools?color=3775a9&label=PyPI" alt="PyPI" /></a>
  &nbsp;
  <a href="https://pypi.org/project/aihydro-tools/"><img src="https://static.pepy.tech/badge/aihydro-tools" alt="Downloads" /></a>
  &nbsp;
  <a href="https://pypi.org/project/aihydro-tools/"><img src="https://img.shields.io/pypi/pyversions/aihydro-tools" alt="Python" /></a>
  &nbsp;
  <a href="https://github.com/AI-Hydro/AI-Hydro/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-Apache%202.0-green" alt="License" /></a>
  &nbsp;
  <a href="https://github.com/AI-Hydro/AI-Hydro/actions/workflows/docs.yml"><img src="https://img.shields.io/github/actions/workflow/status/AI-Hydro/AI-Hydro/docs.yml?label=docs" alt="Docs" /></a>
  &nbsp;
  <a href="https://doi.org/10.5281/zenodo.19597664"><img src="https://img.shields.io/badge/DOI-10.5281%2Fzenodo.19597664-blue" alt="DOI" /></a>
</p>

---

!!! tip "Project Status"
    AI-Hydro is in active **beta** (v0.1.x). Core APIs are stable; new tools and features are being added regularly. Not yet recommended for production pipelines without pinned versions.

---

## Who Is This For?

AI-Hydro is built for **hydrology PhD students, computational hydrologists, and research groups** who need reproducible, well-documented workflows — without spending half their time writing data-fetching glue code or debugging format mismatches between libraries.

If you work with USGS gauges, CAMELS catchments, or any watershed-scale analysis and want an AI agent that can orchestrate the full pipeline and record everything it does, this is for you.

---

## The Problem

Hydrological research today involves a fragmented cycle: downloading data from scattered federal APIs, wrangling formats, writing processing scripts, calibrating models, and documenting provenance — **often spending more time on plumbing than on science.**

This friction compounds a deeper structural failure: fewer than 7% of published computational hydrology studies provide sufficient code, data, and workflow documentation for independent replication, a rate that has barely moved despite a decade of open-science advocacy.

**AI-Hydro addresses this directly** — not by making AI the hero, but by making **reproducibility automatic**. Every tool call is recorded with its data source, parameters, and timestamp. The AI agent is the interface; provenance is the product.

---

## What AI-Hydro Can Do

<div class="feature-grid" markdown>

<div class="feature-card" markdown>
<div class="icon">🌊</div>

### Watershed Analysis

Delineate watersheds, fetch streamflow, extract hydrological signatures, characterize geomorphology — all from a USGS gauge ID, in one conversation.

[→ Analysis tools](tools/analysis.md)
</div>

<div class="feature-card" markdown>
<div class="icon">🧠</div>

### Hydrological Modelling

Calibrate differentiable conceptual models or train deep learning rainfall-runoff models. Results cached with full provenance.

[→ Modelling tools](tools/modelling.md)
</div>

<div class="feature-card" markdown>
<div class="icon">📁</div>

### Project Workspace

Organise research across multiple gauges, regions, and topics. Search across all your experiments in one command.

[→ Project workspace](guide/project-session.md)
</div>

<div class="feature-card" markdown>
<div class="icon">📚</div>

### Literature Module

Drop your PDFs into a folder. Index them. Ask the agent to synthesise across your own paper collection — no vector database required.

[→ Literature module](guide/literature.md)
</div>

<div class="feature-card" markdown>
<div class="icon">🧬</div>

### Researcher Profile

The agent learns who you are — your expertise, preferred models, active projects — and tailors responses accordingly across every session.

[→ Researcher profile](guide/researcher-profile.md)
</div>

<div class="feature-card" markdown>
<div class="icon">🔌</div>

### Community Plugins

Any Python package can register domain tools via entry points. Flood frequency, sediment transport, groundwater, remote sensing — community-built and auto-discovered.

[→ Plugin guide](plugins/overview.md)
</div>

</div>

---

## Quick Example

```
You: Delineate the watershed for USGS gauge 01031500, extract hydrological
     signatures, and calibrate a differentiable HBV model on GridMET forcing.

AI-Hydro:
  ✓ Watershed delineated — 1,247 km² (NHDPlus, NLDI)
  ✓ Streamflow fetched — 14,975 daily records (2000–2024, USGS NWIS)
  ✓ Hydrological signatures extracted — BFI: 0.52, runoff ratio: 0.41, ...
  ✓ HBV-light calibrated — NSE: 0.81, KGE: 0.78 (validation period)
  ✓ Session saved → ~/.aihydro/sessions/01031500.json
```

No code written. No data downloaded manually. Full provenance recorded automatically.

---

## Why AI-Hydro?

| | AI-Hydro | Writing scripts yourself | HydroMT | NeuralHydrology |
|--|--|--|--|--|
| **Reproducibility** | Automatic — every step recorded | Manual — only if you remember | Partial — config files | Manual |
| **AI-native workflow** | Yes — natural language → computation | No | No | No |
| **MCP / agent integration** | Yes | No | No | No |
| **Session persistence** | Yes — survives restarts | No | Partial | No |
| **Researcher memory** | Yes — profile + project state | No | No | No |
| **Built-in data access** | USGS, GridMET, 3DEP, NLCD, CAMELS | DIY | Config-driven | CAMELS only |
| **Community extensible** | Yes — Python entry points | N/A | Yes — plugins | No |
| **Learning curve** | Low — describe intent | High | Medium | High |

AI-Hydro is **not a replacement** for HydroMT or NeuralHydrology — it can call them as standalone scripts. It is the orchestration and provenance layer that sits above domain tools.

---

## Installation

=== "VS Code Extension"

    Search **AI-Hydro** in the VS Code Extensions panel, or install from the [Marketplace](https://marketplace.visualstudio.com/items?itemName=aihydro.ai-hydro).

    The extension auto-detects `aihydro-mcp` on startup — no manual server configuration needed.

=== "Python Package Only"

    ```bash
    pip install aihydro-tools[all]
    aihydro-mcp --diagnose
    ```

    Use with any MCP-compatible client (Claude Desktop, custom agents, etc.).

---

## Supported AI Models

AI-Hydro works with any provider that supports tool/function calling. No model-specific code — switching providers is a single setting change.

| Provider | Supported models |
|----------|-----------------|
| **Anthropic** | Claude Sonnet, Claude Opus (any released version) |
| **OpenAI** | GPT-4o, GPT-4o mini, o3, o4-mini and later |
| **Google** | Gemini 2.0 Flash, Gemini 2.5 Pro and later |
| **AWS Bedrock** | Claude on Bedrock, any Bedrock model with tool use |
| **Azure OpenAI** | GPT models via Azure endpoint |
| **Local** | Ollama, LM Studio (models with tool-call support) |
| **OpenRouter** | Any model via OpenRouter API |

---

## Built on Open Source

AI-Hydro is a domain-specific fork of [Cline](https://github.com/cline/cline) (Apache 2.0).
The Python backend is built on the scientific Python ecosystem:

| Package | Role |
|---------|------|
| [fastmcp](https://github.com/jlowin/fastmcp) | MCP server framework |
| [hydrofunctions](https://hydrofunctions.readthedocs.io/) | USGS NWIS streamflow retrieval |
| [pynhd](https://hyriver.readthedocs.io/en/latest/pynhd.html) | NHDPlus watershed delineation |
| [pygeohydro](https://hyriver.readthedocs.io/en/latest/pygeohydro.html) | NLCD, CAMELS, geospatial data |
| [pygridmet](https://hyriver.readthedocs.io/en/latest/pygridmet.html) | GridMET climate forcing |
| [py3dep](https://hyriver.readthedocs.io/en/latest/py3dep.html) | 3DEP DEM and terrain analysis |
| [pydantic](https://docs.pydantic.dev/) | Data validation |

If you use AI-Hydro in your research, see **[Citing AI-Hydro](citing.md)** for BibTeX entries for the platform and all data sources.
