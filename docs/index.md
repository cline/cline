---
hide:
  - toc
---
<div class="hero" markdown>

# AI-Hydro

<p class="tagline">Open Platform For Autonomous Hydrological Research</p>

<p style="color: #94a3b8; font-size: 1rem; max-width: 820px; margin: 0 auto 0.6rem;">
  Not just code generation — end-to-end research execution.
</p>

<p style="color: #7dd3fc; font-size: 0.95rem; max-width: 780px; margin: 0 auto 1.5rem;">
  AI-Hydro connects validated tools, community knowledge, standardized workflows, and data sources
  into a single environment where AI agents can perform real, reproducible hydrological research —
  from the first data request to the final model results.
</p>

[Get Started](getting-started/installation.md){ .md-button .md-button--primary }
[View on GitHub](https://github.com/AI-Hydro/AI-Hydro){ .md-button }
[Read the Architecture](architecture.md){ .md-button }
[Contribute Plugins](plugins/overview.md){ .md-button }
[How To Contribute](contributing.md){ .md-button }

</div>

<p align="center">
  <a href="https://marketplace.visualstudio.com/items?itemName=aihydro.ai-hydro"><img src="https://img.shields.io/visual-studio-marketplace/v/aihydro.ai-hydro?label=VS%20Code%20Marketplace&color=0078d7" alt="Marketplace" /></a>
   
  <a href="https://pypi.org/project/aihydro-tools/"><img src="https://img.shields.io/pypi/v/aihydro-tools?color=3775a9&label=PyPI" alt="PyPI" /></a>
   
  <a href="https://pypi.org/project/aihydro-tools/"><img src="https://static.pepy.tech/badge/aihydro-tools" alt="Downloads" /></a>
   
  <a href="https://pypi.org/project/aihydro-tools/"><img src="https://img.shields.io/pypi/pyversions/aihydro-tools" alt="Python" /></a>
   
  <a href="https://github.com/AI-Hydro/AI-Hydro/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-Apache%202.0-green" alt="License" /></a>
   
  <a href="https://github.com/AI-Hydro/AI-Hydro/actions/workflows/docs.yml"><img src="https://img.shields.io/github/actions/workflow/status/AI-Hydro/AI-Hydro/docs.yml?label=docs" alt="Docs" /></a>
   
  <a href="https://doi.org/10.5281/zenodo.19597664"><img src="https://img.shields.io/badge/DOI-10.5281%2Fzenodo.19597664-blue" alt="DOI" /></a>
</p>

---

<div style="position:relative;padding-bottom:56.25%;height:0;overflow:hidden;border-radius:8px;margin:1.5rem 0;">
  <iframe
    src="https://www.youtube.com/embed/8YEQmEkid90"
    title="What if an AI Agent Could Run Your Entire Hydrology Study? — AI-Hydro Introduction"
    style="position:absolute;top:0;left:0;width:100%;height:100%;border:0;"
    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
    allowfullscreen>
  </iframe>
</div>

---

!!! tip "Project Status"
    AI-Hydro is in active **beta**. The platform is already useful for real research workflows, but it is still evolving quickly. Pin versions for serious projects and expect new tools, better outputs, and broader data/model support over time.

---

## Why AI-Hydro Exists

General-purpose AI tools — Copilot, Cursor, Claude Code — are transforming software development. But when it comes to scientific research, they struggle.

Without domain-specific grounding, they hallucinate methods, misuse domain libraries, and produce plausible-looking but unreliable workflows. They cannot reliably execute real research end to end.

At the same time, the hydrology research workflow remains fragmented — even with strong foundations:

- excellent Python libraries
- benchmark datasets like CAMELS
- public APIs for streamflow, terrain, land cover, and forcing data
- mature modeling systems

Researchers still spend too much of their time on:

- retrieving data from scattered systems
- wrangling formats between libraries
- writing one-off scripts
- debugging brittle workflows
- reconstructing provenance after the fact

It is manual, time-consuming, and hard to scale.

**AI-Hydro is built to close that gap.**

It gives AI agents a domain-specific research environment — not a general assistant, but a platform built for this kind of work:

- validated hydrology and geospatial tools
- persistent research session state
- provenance-aware outputs
- extensible plugin architecture
- a workflow layer above fragmented domain packages

The point is not just AI assistance.
The point is to build the open infrastructure required for increasingly autonomous, reproducible scientific research.

---

## What Researchers Should Get Back

AI-Hydro is built for researchers who want to focus on:

- scientific questions
- interpretation
- hypothesis generation
- model criticism
- uncertainty reasoning
- comparison across basins, regions, and scales

not on:

- data plumbing
- repetitive coding
- workflow assembly
- manual provenance bookkeeping
- re-explaining context across sessions

In other words, the aim is not to replace scientists.
It is to reduce the accidental burdens that keep computational science from feeling like science.

---

## What AI-Hydro Can Do Today

<div class="feature-grid" markdown>

<div class="feature-card" markdown>
<div class="icon">🌊</div>

### Watershed Analysis

Delineate watersheds, retrieve streamflow, compute hydrological signatures, derive terrain metrics, and characterize basin form from a single conversation.

[→ Analysis tools](tools/analysis.md)

</div>

<div class="feature-card" markdown>
<div class="icon">🧠</div>

### Hydrological Modelling

Calibrate differentiable conceptual models or train rainfall-runoff deep learning models with session-aware inputs and cached outputs.

[→ Modelling tools](tools/modelling.md)

</div>

<div class="feature-card" markdown>
<div class="icon">📁</div>

### Persistent Research State

Sessions, projects, and researcher context persist across conversations so the platform remembers what was computed, why it matters, and what comes next.

[→ Sessions &amp; Provenance](guide/sessions.md)

</div>

<div class="feature-card" markdown>
<div class="icon">📚</div>

### Literature-Aware Workflows

Index your own PDFs, search them, and let the agent synthesize findings against your active project and computed results.

[→ Literature module](guide/literature.md)

</div>

<div class="feature-card" markdown>
<div class="icon">🧬</div>

### Researcher Profile

The platform stores your stated expertise, preferred methods, active projects, and reporting style across sessions, so the agent re-loads that context every conversation instead of you re-explaining it.

[→ Researcher profile](guide/researcher-profile.md)

</div>

<div class="feature-card" markdown>
<div class="icon">🔌</div>

### Community Plugins

Any Python package can register domain tools. Flood frequency, sediment, groundwater, snow, remote sensing, and more can become agent-usable through the plugin system.

[→ Plugin guide](plugins/overview.md)

</div>

</div>

---

## A Typical Workflow

```text
You:
  Delineate the watershed for USGS gauge 01031500, retrieve the last 20 years
  of streamflow, extract hydrological signatures, and calibrate an HBV-light model.

AI-Hydro:
  ✓ Session started
  ✓ Watershed delineated — 1,247 km²
  ✓ Streamflow retrieved — 7,300+ daily observations
  ✓ Signatures extracted — BFI, runoff ratio, FDC slope, variability, seasonality
  ✓ GridMET forcing retrieved
  ✓ HBV-light calibrated — NSE and KGE stored with provenance
  ✓ Session context written for future conversations
```

No manual API choreography.
No ad hoc script chain.
No disconnected outputs.

Every major step is recorded with data source, parameters, timing, and reusable session state.

---

## Why This Is Different

|                                             | AI-Hydro | Writing scripts yourself | Single-purpose hydro package |
| ------------------------------------------- | -------- | ------------------------ | ---------------------------- |
| **Natural language to computation**   | Yes      | No                       | No                           |
| **Built-in provenance**               | Yes      | Manual                   | Usually partial              |
| **Persistent research state**         | Yes      | No                       | Usually no                   |
| **Agent tool orchestration**          | Yes      | No                       | No                           |
| **Community-extensible domain tools** | Yes      | N/A                      | Sometimes                    |
| **Focus on hydrology workflows**      | Yes      | Depends on user          | Usually narrow               |

AI-Hydro is not trying to replace domain libraries like HyRiver, HydroMT, NeuralHydrology, or other hydrology packages.

It sits above them as a research orchestration layer:

- where tools become agent-usable
- where workflows become reproducible
- where sessions become persistent
- and where outputs remain scientifically traceable

---

## Community Vision

The long-term vision is larger than the current built-in toolset.

AI-Hydro is being built as an **open platform**, not a closed assistant:

- built-in tools for common hydrology workflows
- community-contributed plugins for new domains
- agent-readable scientific knowledge
- reusable, provenance-aware research workflows

If Codex, Copilot, Cursor, and Claude Code are becoming operating environments for software engineering, AI-Hydro is asking:

**what would the equivalent look like for hydrology and earth science?**

That is the direction of this project.

If you want to help build it:

- [Contributing guide](contributing.md)
- [Plugin overview](plugins/overview.md)
- [AI-Hydro DOI](https://doi.org/10.5281/zenodo.19597664)
- [aihydro-tools DOI](https://doi.org/10.5281/zenodo.19597589)

---

## Get Started

=== "VS Code Extension"

    Install the extension from the[VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=aihydro.ai-hydro) and connect your preferred AI provider.

    The extension auto-detects`aihydro-mcp` on startup, so the hydrology tool server becomes available without manual JSON configuration.

=== "Python Package"

    ```bash
    pip install aihydro-tools[all]
    aihydro-mcp --diagnose
    ```

    Use the MCP server with the VS Code extension or any MCP-compatible client.

---

## Open Foundations

AI-Hydro builds on open-source agent and scientific computing foundations.
The extension originated from the [Cline](https://github.com/cline/cline) codebase (Apache 2.0), but the platform is being extended into a domain-specific environment for hydrological and earth science research.

The Python backend builds on the scientific Python ecosystem, including:

- `fastmcp`
- `pynhd`
- `pygeohydro`
- `pygridmet`
- `py3dep`
- `hydrofunctions`
- `pydantic`

If you use AI-Hydro in your research, see [Citing AI-Hydro](citing.md) for platform and data-source citations.

---

## Where To Next

- [Installation](getting-started/installation.md)
- [Quickstart](getting-started/quickstart.md)
- [Architecture](architecture.md)
- [Tool Reference](tools/index.md)
- [Plugin Overview](plugins/overview.md)
- [Contributing](contributing.md)
