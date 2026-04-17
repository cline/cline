# Contributing

AI-Hydro is being built as open infrastructure for autonomous hydrological research.
The most impactful contributions are validated domain methods that an AI agent can
invoke reproducibly — structured inputs, structured outputs, no human intervention required.

---

## What makes a good AI-Hydro plugin?

Before choosing what to build, check whether your idea fits the platform's requirements:

| Requirement | Good fit | Poor fit |
|-------------|----------|----------|
| **Python-native** | Pure Python library (`pip install`) | Needs compiled C/Fortran, GUI, or Windows COM |
| **Runs unattended** | No interactive prompts | Requires user input mid-run |
| **Structured output** | Returns a dict with clear keys | Produces files only (no parsed result) |
| **Defined inputs** | Takes a gauge ID, geometry, or date range | Requires manual configuration of dozens of parameters |
| **Reasonable runtime** | Completes in seconds to minutes | Hours-long simulation |

If your idea doesn't fit all five, consider contributing a **knowledge plugin** instead
(see [Path C](plugins/entry-point.md)) — documenting how an agent should use the library
correctly is often more valuable than wrapping it.

---

## Three ways to contribute

| Type | What you build | Path |
|------|---------------|------|
| **Tool plugin** | A new callable MCP tool — new data source, analysis method, or model wrapper | [Path A](plugins/standalone-server.md) or [Path B](plugins/entry-point.md) |
| **Knowledge plugin** | Field-name mappings, API gotchas, and code patterns for a library | [Path C](plugins/entry-point.md#knowledge-plugins) |
| **Core contribution** | Bug fix, new feature, or improvement to the built-in tools or extension | Fork and PR |

See the [Plugin Guide](plugins/overview.md) for complete walkthroughs.

---

## Good first contributions

These are specific, achievable tasks with a clear Python path. Each one is something a
researcher already familiar with the domain could complete in a few days.

### Tools (Path A or B)

**Flood frequency analysis**
Fit a GEV or log-Pearson III distribution to a gauge's annual maximum series (already
accessible via `fetch_streamflow_data`) and return a return-period table (2, 5, 10, 25,
50, 100-year flows). `scipy.stats` and `lmoments3` both support this cleanly.
Well-defined inputs (streamflow record), well-defined output (return-period table).

**Low-flow statistics**
Compute 7Q10, 7Q2, and related low-flow indices from a streamflow record. These are
regulatory and ecological standards that aren't in the current signature tool. Any
implementation using the existing `fetch_streamflow_data` output would slot in immediately.

**USGS groundwater levels**
Fetch groundwater level records for a USGS well via `dataretrieval.nwis.get_gwlevels()`.
The library already used for streamflow supports this — it's a two-line extension.
Return depth-to-water time series, seasonal statistics, and trend estimate.

**USGS water quality**
Fetch discrete water quality measurements (nitrate, phosphorus, turbidity, pH) for a
gauge via `dataretrieval.nwis.get_qwdata()`. Compute seasonal load estimates.
Straightforward extension of the existing data retrieval pattern.

**Global discharge lookup**
Access the Global Runoff Data Centre (GRDC) catalogue for a user-specified region and
return gauge metadata + available date ranges. The GRDC provides an open API and
Python tools exist (`grdc-getter`). This would be the first non-US data tool.

**SNOTEL snow metrics**
Fetch NRCS SNOTEL station data for a watershed (snow water equivalent, snow depth,
precipitation) via `ulmo` or direct NRCS API calls. Return seasonal statistics and
peak SWE date. Especially valuable for western US headwater catchments.

**Baseflow separation methods comparison**
Extend the current `extract_hydrological_signatures` BFI with alternative methods
(Chapman, Boughton, recursive digital filter variants). The current tool uses only
the Eckhardt filter — a plugin returning a comparison table would be immediately useful.

### Knowledge plugins (Path C)

These don't add new executable tools but help agents use existing scientific libraries
correctly. Each should document: correct field names, unit conventions, common
pitfalls, and a minimal working example.

**`swmmio`** — Python interface for SWMM urban drainage models. Mature, well-maintained,
commonly used by urban hydrology researchers. Agents consistently confuse the
model object structure and node/link field names.

**`nlmod`** — Python interface for MODFLOW 6 (USGS groundwater model). Has a coherent
Python API (Netherlands-based open development). Agents hallucinate parameter names;
a reference card would prevent most errors.

**`oggm`** — Open Global Glacier Model. Well-documented Python API, actively maintained
by a large community. Useful for hydrology studies in glacierized catchments.

**`dataretrieval`** — The USGS data retrieval library already used by AI-Hydro.
A knowledge plugin with the exact column names for different parameter codes (discharge,
stage, temperature, groundwater) would prevent the most common agent errors.

**`pysheds`** — Watershed delineation from local DEMs (as opposed to the NLDI
web-service approach used by AI-Hydro). Field name gotchas and projection handling
are the main agent failure modes.

---

## Larger investments (for groups or funded projects)

These are legitimate long-term directions but are not weekend contributions.
They require sustained effort and are listed here for planning purposes:

- **SWMM model builder** — constructing and running a SWMM model from GIS inputs.
  `swmmio` handles reading/writing; the hard part is the model-building workflow.
- **Global soil data** — SoilGrids 2.0 access via REST API as an alternative to
  the current POLARIS (CONUS-only) soil tool.
- **Remote sensing indices** — NDVI, NDWI, EVI time series from Landsat/Sentinel via
  `pystac` + `odc-stac`. The data access pattern is clear; the challenge is spatial
  extent handling for arbitrary watershed geometries.

If you are planning one of these, open a GitHub issue first so we can coordinate.

!!! note "What we are NOT asking for"
    Please do not open PRs wrapping tools that require external software installation
    (HEC-RAS COM automation, VIC model compilation, SWAT+ executable) or tools that
    require GUI interaction. These cannot run as unattended MCP tools. If you want to
    connect AI-Hydro to one of these models, the right path is a standalone subprocess
    integration — open an issue to discuss the design first.

---

## Core contributions

For contributions to the built-in tools or the extension itself:

1. **Fork** [AI-Hydro/AI-Hydro](https://github.com/AI-Hydro/AI-Hydro) or [AI-Hydro/aihydro-tools](https://github.com/AI-Hydro/aihydro-tools)
2. **Create a branch** — `feat/your-feature` or `fix/your-bug`
3. **Write tests** — see `python/tests/` for the integration test pattern
4. **Open a pull request** — describe what it does, what data source or library it uses,
   and what the expected output structure is

### Running tests

```bash
pip install aihydro-tools[dev]
pytest tests/ -m "not live" -v
```

The `not live` marker skips tests that require internet access. These run in CI.

### Code style

Python: [Ruff](https://github.com/astral-sh/ruff) — `ruff check . && ruff format .`  
TypeScript: [Biome](https://biomejs.dev/) — `npx biome check .`

---

## Documentation contributions

The documentation site is built with [MkDocs Material](https://squidfunk.github.io/mkdocs-material/).

```bash
pip install mkdocs-material mkdocs-minify-plugin
mkdocs serve
```

Open `http://localhost:8000` to preview changes locally. Documentation improvements —
especially corrections to tool descriptions, clearer examples, or domain-specific usage
guides — are among the most useful contributions a domain expert can make.

---

## Reporting issues

- **Extension bugs:** [AI-Hydro/AI-Hydro/issues](https://github.com/AI-Hydro/AI-Hydro/issues)
- **Python package bugs:** [AI-Hydro/aihydro-tools/issues](https://github.com/AI-Hydro/aihydro-tools/issues)
- **Feature requests:** Open an issue with the `enhancement` label

When reporting a tool failure, include the tool name, the error message from the
AI-Hydro output panel, and the gauge ID or input you used.

---

## License

By contributing, you agree that your contributions will be licensed under the
[Apache 2.0 License](https://www.apache.org/licenses/LICENSE-2.0).
