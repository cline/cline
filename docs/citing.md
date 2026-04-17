---
description: BibTeX citations for AI-Hydro platform and all data sources — USGS NWIS, GridMET, 3DEP, CAMELS-US, NLCD, NHDPlus — for use in research papers.
---

# Citing AI-Hydro

If you use AI-Hydro in your research, please cite the platform and the underlying data sources your analysis relied on.

---

## Platform Citation

**VS Code Extension** (DOI: [10.5281/zenodo.19597664](https://doi.org/10.5281/zenodo.19597664))

```bibtex
@software{aihydro_extension_2026,
  title   = {AI-Hydro: An Open Platform for Autonomous Hydrological and
             Earth Science Research},
  author  = {Galib, Mohammad and Merwade, Venkatesh},
  year    = {2026},
  version = {0.1.4},
  doi     = {10.5281/zenodo.19597664},
  url     = {https://doi.org/10.5281/zenodo.19597664},
  license = {Apache-2.0}
}
```

**Python MCP Server** (DOI: [10.5281/zenodo.19597589](https://doi.org/10.5281/zenodo.19597589))

```bibtex
@software{aihydro_tools_2026,
  title   = {aihydro-tools: An Open Python MCP Server for Autonomous
             Hydrological Research},
  author  = {Galib, Mohammad and Merwade, Venkatesh},
  year    = {2026},
  version = {1.2.1},
  doi     = {10.5281/zenodo.19597589},
  url     = {https://doi.org/10.5281/zenodo.19597589},
  license = {Apache-2.0}
}
```

!!! tip "Which should I cite?"
    Cite **both** if you used the VS Code extension and ran analyses through it.
    Cite only **aihydro-tools** if you used the Python package or MCP server directly
    without the extension. When in doubt, cite both — they are companion releases.

---

## Data Source Citations

AI-Hydro fetches data from authoritative federal services. Cite whichever sources your analysis used:

### USGS Streamflow (NWIS)

```bibtex
@misc{usgs_nwis,
  author    = {{U.S. Geological Survey}},
  title     = {National Water Information System: Web Interface},
  year      = {2016},
  url       = {https://waterdata.usgs.gov/nwis},
  note      = {Accessed via USGS waterservices REST API}
}
```

### NHDPlus / NLDI (Watershed Delineation)

```bibtex
@misc{usgs_nldi,
  author    = {{U.S. Geological Survey}},
  title     = {Hydro Network-Linked Data Index (NLDI)},
  year      = {2019},
  url       = {https://waterdata.usgs.gov/blog/nldi-intro/}
}
```

### GridMET (Climate Forcing)

```bibtex
@article{abatzoglou2013,
  author  = {Abatzoglou, John T.},
  title   = {Development of gridded surface meteorological data for ecological
             applications and modelling},
  journal = {International Journal of Climatology},
  year    = {2013},
  volume  = {33},
  number  = {1},
  pages   = {121--131},
  doi     = {10.1002/joc.3413}
}
```

### 3DEP (Digital Elevation Model)

```bibtex
@misc{usgs_3dep,
  author = {{U.S. Geological Survey}},
  title  = {3D Elevation Program (3DEP)},
  year   = {2022},
  url    = {https://www.usgs.gov/3d-elevation-program}
}
```

### CAMELS-US (Catchment Attributes)

```bibtex
@article{addor2017,
  author  = {Addor, Nans and Newman, Andrew J. and Mizukami, Naoki and Clark, Martyn P.},
  title   = {The CAMELS data set: catchment attributes and meteorology for
             large-sample studies},
  journal = {Hydrology and Earth System Sciences},
  year    = {2017},
  volume  = {21},
  pages   = {5293--5313},
  doi     = {10.5194/hess-21-5293-2017}
}

@article{newman2015,
  author  = {Newman, Andrew J. and Clark, Martyn P. and Sampson, Kevin and Wood,
             Andrew and Hay, Lauren E. and Bock, Andy and Viger, Roland J. and
             Blodgett, David and Brekke, Levi and Arnold, Jeffrey R. and
             Hopson, Thomas and Duan, Qingyun},
  title   = {Development of a large-sample watershed-scale hydrometeorological
             data set for the contiguous {USA}: data set characteristics and
             assessment of regional variability in hydrologic model performance},
  journal = {Hydrology and Earth System Sciences},
  year    = {2015},
  volume  = {19},
  pages   = {209--223},
  doi     = {10.5194/hess-19-209-2015}
}
```

### NLCD (Land Cover)

```bibtex
@misc{nlcd2019,
  author = {{Multi-Resolution Land Characteristics Consortium}},
  title  = {National Land Cover Database 2019 (NLCD 2019)},
  year   = {2021},
  url    = {https://www.mrlc.gov/}
}
```

---

## Provenance-Based Citation

AI-Hydro automatically records the data sources, retrieval timestamps, and parameters for every analysis step. Use `export_session` to generate a formatted methods paragraph with embedded citations — ready to paste into your manuscript:

```
Export the session for gauge 01031500 as a methods paragraph.
```

See [Provenance & Session Schema](provenance.md) for details on what is recorded.

---

## Model Context Protocol

If your work specifically uses or evaluates the MCP integration:

```bibtex
@misc{anthropic_mcp2024,
  author = {{Anthropic}},
  title  = {Model Context Protocol},
  year   = {2024},
  url    = {https://modelcontextprotocol.io/}
}
```
