# Contributing

The most impactful way to contribute to AI-Hydro is adding domain tools — knowledge that currently lives in papers and custom scripts, packaged so any AI agent can discover and use it.

---

## Plugin Contributions

There are three ways to contribute:

| Type | What you build | Entry point |
|------|---------------|-------------|
| **Tool plugin** | New MCP tool (e.g., flood frequency analysis) | `aihydro.tools` |
| **Knowledge plugin** | Library reference card (gotchas, field names, patterns) | `aihydro.knowledge` |
| **Standalone server** | Full sub-domain toolkit with separate process | Any MCP client |

See the [Plugin Guide](plugins/overview.md) for complete walkthroughs for all three paths.

**High-priority tool domains:**

- Flood frequency analysis and extreme event statistics
- Sediment transport and reservoir sedimentation
- Groundwater modelling, well analysis, and recharge estimation
- Remote sensing workflows (MODIS snow, Landsat ET, SAR soil moisture)
- Water quality and nutrient cycling
- Snow hydrology and glaciology
- Irrigation scheduling and water resources management
- Hydraulic modelling and 2D flood mapping

**High-priority knowledge cards** (library references not yet contributed):

- `swmmio` — SWMM model Python interface
- `hecras` — HEC-RAS automation
- `nlmod` — MODFLOW/MODFLOW 6 Python interface
- `oggm` — Open Global Glacier Model
- `snowpack` — Alpine3D / SNOWPACK model
- `pywr` — Pywr water resources network model

---

## Core Contributions

For contributions to the core platform:

1. **Fork** [AI-Hydro/AI-Hydro](https://github.com/AI-Hydro/AI-Hydro) or [AI-Hydro/aihydro-tools](https://github.com/AI-Hydro/aihydro-tools)
2. **Create a branch** — `feat/your-feature` or `fix/your-bug`
3. **Write tests** — see `python/tests/` for examples
4. **Open a pull request** with a description of what and why

### Running Tests

```bash
cd python
pip install aihydro-tools[dev]
pytest tests/ -m "not live" -v
```

The `not live` marker skips tests that require internet access and full dependencies. These run in CI.

### Code Style

Python: [Ruff](https://github.com/astral-sh/ruff) (`ruff check .` and `ruff format .`)  
TypeScript: Biome (`npx biome check .`)

---

## Documentation Contributions

This documentation site is built with [MkDocs Material](https://squidfunk.github.io/mkdocs-material/).

```bash
pip install mkdocs-material mkdocs-minify-plugin
mkdocs serve
```

Open `http://localhost:8000` to preview changes locally.

---

## Reporting Issues

- **Bugs:** [github.com/AI-Hydro/AI-Hydro/issues](https://github.com/AI-Hydro/AI-Hydro/issues)
- **Python package bugs:** [github.com/AI-Hydro/aihydro-tools/issues](https://github.com/AI-Hydro/aihydro-tools/issues)
- **Feature requests:** Open an issue with the `enhancement` label

---

## License

By contributing, you agree that your contributions will be licensed under the [Apache 2.0 License](https://www.apache.org/licenses/LICENSE-2.0).
