"""
AI-Hydro Citation Registry
===========================

Three-tier citation system:

  Tier 1 — Data source citations: hardcoded per tool, auto-collected when tools run.
  Tier 2 — Platform citations: AI-Hydro + aihydro-tools, always included.
  Tier 3 — Plugin citations: declared in plugin package metadata (future; see CONTRIBUTING.md).

Usage
-----
Citations accumulate in HydroSession._citations as tool calls succeed.
``export_bibtex()`` builds a ready-to-use .bib file from the collected keys.
``sync_research_context`` and ``export_session`` write citations.bib automatically.

Adding a new data source
------------------------
1. Add its BibTeX entry to ``BIBTEX_ENTRIES`` with a stable snake_case key.
2. Map it in ``TOOL_CITATIONS`` for every tool that uses that source.

Plugin citation support (Tier 3)
---------------------------------
Plugin packages can declare citation metadata in pyproject.toml:

    [tool.aihydro.citation]
    doi   = "10.5281/zenodo.XXXXXXX"
    bibtex = '''
    @software{my_plugin,...}
    '''

The plugin registry (ai_hydro.mcp.registry) reads this metadata on discovery
and registers it here via ``register_plugin_citation()``.
"""

from __future__ import annotations

# ---------------------------------------------------------------------------
# Tier 1 + 2  — hardcoded BibTeX entries
# ---------------------------------------------------------------------------

BIBTEX_ENTRIES: dict[str, str] = {

    # ── Data sources (Tier 1) ───────────────────────────────────────────────

    "usgs_nwis": """\
@misc{usgs_nwis,
  author = {{U.S. Geological Survey}},
  title  = {National Water Information System: Web Interface},
  year   = {2016},
  url    = {https://waterdata.usgs.gov/nwis},
  note   = {Accessed via aihydro-tools}
}""",

    "nhd_nhdplus": """\
@misc{nhd_nhdplus,
  author = {{U.S. Geological Survey and U.S. Environmental Protection Agency}},
  title  = {National Hydrography Dataset Plus ({NHDPlus}) and
            Network Linked Data Index ({NLDI})},
  year   = {2019},
  url    = {https://www.usgs.gov/national-hydrography/national-hydrography-dataset},
  note   = {Accessed via pynhd and aihydro-tools}
}""",

    "usgs_3dep": """\
@misc{usgs_3dep,
  author = {{U.S. Geological Survey}},
  title  = {3{D} Elevation Program ({3DEP})},
  year   = {2015},
  url    = {https://www.usgs.gov/3d-elevation-program},
  note   = {Accessed via py3dep and aihydro-tools}
}""",

    "abatzoglou2013gridmet": """\
@article{abatzoglou2013gridmet,
  author  = {Abatzoglou, John T.},
  title   = {Development of gridded surface meteorological data for
             ecological applications and modelling},
  journal = {International Journal of Climatology},
  volume  = {33},
  number  = {1},
  pages   = {121--131},
  year    = {2013},
  doi     = {10.1002/joc.3413}
}""",

    "nlcd2021": """\
@misc{nlcd2021,
  author = {{Multi-Resolution Land Characteristics (MRLC) Consortium}},
  title  = {National Land Cover Database ({NLCD}) 2021},
  year   = {2023},
  url    = {https://www.mrlc.gov/data},
  note   = {Accessed via pygeohydro and aihydro-tools}
}""",

    "chaney2019polaris": """\
@article{chaney2019polaris,
  author  = {Chaney, Nathaniel W. and Minasny, Budiman and Herman, Jonathan D.
             and Nauman, Travis W. and Brungard, Colby W. and Morgan, Cristine L.S.
             and McBratney, Alex B. and Wood, Eric F. and Yimam, Yohannes},
  title   = {{POLARIS} Soil Properties: 30-Meter Probabilistic Maps of Soil
             Properties Over the Contiguous {United States}},
  journal = {Water Resources Research},
  volume  = {55},
  number  = {4},
  pages   = {2916--2938},
  year    = {2019},
  doi     = {10.1029/2018WR022797}
}""",

    "addor2017camels": """\
@article{addor2017camels,
  author  = {Addor, Nans and Newman, Andrew J. and Mizukami, Naoki and Clark, Martyn P.},
  title   = {The {CAMELS} data set: catchment attributes and meteorology
             for large-sample studies},
  journal = {Hydrology and Earth System Sciences},
  volume  = {21},
  number  = {10},
  pages   = {5293--5313},
  year    = {2017},
  doi     = {10.5194/hess-21-5293-2017}
}""",

    "seibert2012hbv": """\
@article{seibert2012hbv,
  author  = {Seibert, Jan and Vis, Marc J.P.},
  title   = {Teaching hydrological modeling with a user-friendly
             catchment-runoff-model software package},
  journal = {Hydrology and Earth System Sciences},
  volume  = {16},
  number  = {9},
  pages   = {3315--3325},
  year    = {2012},
  doi     = {10.5194/hess-16-3315-2012}
}""",

    # ── Platform (Tier 2) ────────────────────────────────────────────────────

    "aihydro": """\
@software{aihydro2026,
  author  = {Galib, Mohammad},
  title   = {{AI-Hydro}: Open Platform for Autonomous Hydrological Research},
  year    = {2026},
  doi     = {10.5281/zenodo.19597664},
  url     = {https://github.com/AI-Hydro/AI-Hydro},
  license = {Apache-2.0}
}""",

    "aihydro_tools": """\
@software{aihydro_tools2026,
  author  = {Galib, Mohammad},
  title   = {aihydro-tools: Python {MCP} Server and Tool Library for {AI-Hydro}},
  year    = {2026},
  doi     = {10.5281/zenodo.19597589},
  url     = {https://github.com/AI-Hydro/aihydro-tools},
  license = {Apache-2.0}
}""",
}


# ---------------------------------------------------------------------------
# Tier 2 — always included
# ---------------------------------------------------------------------------

PLATFORM_CITATIONS: list[str] = ["aihydro", "aihydro_tools"]


# ---------------------------------------------------------------------------
# Tier 1 — per-tool data source mapping
# ---------------------------------------------------------------------------

TOOL_CITATIONS: dict[str, list[str]] = {
    "delineate_watershed":             ["nhd_nhdplus", "usgs_3dep"],
    "fetch_streamflow_data":           ["usgs_nwis"],
    "extract_hydrological_signatures": ["usgs_nwis"],
    "extract_geomorphic_parameters":   ["usgs_3dep", "nhd_nhdplus"],
    "compute_twi":                     ["usgs_3dep"],
    "create_cn_grid":                  ["nlcd2021", "usgs_3dep"],
    "fetch_forcing_data":              ["abatzoglou2013gridmet"],
    "fetch_lulc_data":                 ["nlcd2021"],
    "fetch_soil_data":                 ["chaney2019polaris"],
    "extract_camels_attributes":       ["addor2017camels"],
    "train_hydro_model":               ["seibert2012hbv"],
}


# ---------------------------------------------------------------------------
# Tier 3 — plugin citations (registered at discovery time)
# ---------------------------------------------------------------------------

_PLUGIN_ENTRIES: dict[str, str] = {}
_PLUGIN_TOOL_MAP: dict[str, list[str]] = {}


def register_plugin_citation(key: str, bibtex: str, tool_names: list[str]) -> None:
    """
    Register a plugin citation at server startup (called from registry.py).

    Parameters
    ----------
    key        : stable BibTeX key (e.g. 'smith2024snowmelt')
    bibtex     : full BibTeX entry string
    tool_names : list of tool function names that should cite this entry
    """
    _PLUGIN_ENTRIES[key] = bibtex
    for name in tool_names:
        _PLUGIN_TOOL_MAP.setdefault(name, []).append(key)


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def citation_keys_for_tool(tool_name: str) -> list[str]:
    """Return all citation keys (Tier 1 + any Tier 3) for a given tool."""
    keys = list(TOOL_CITATIONS.get(tool_name, []))
    keys.extend(_PLUGIN_TOOL_MAP.get(tool_name, []))
    return keys


def build_bibtex(keys: set[str] | list[str], *, header: bool = True) -> str:
    """
    Build a .bib file string from a collection of citation keys.

    Platform citations (Tier 2) are always prepended.
    Plugin entries (Tier 3) are included if their keys appear in ``keys``.
    Unknown keys are silently skipped.
    """
    all_entries = {**BIBTEX_ENTRIES, **_PLUGIN_ENTRIES}
    # Platform citations always first, then the rest in stable order
    ordered: list[str] = list(PLATFORM_CITATIONS)
    for k in keys:
        if k not in ordered:
            ordered.append(k)

    seen: set[str] = set()
    entries: list[str] = []
    for key in ordered:
        if key in seen or key not in all_entries:
            continue
        entries.append(all_entries[key])
        seen.add(key)

    if not entries:
        return ""

    parts: list[str] = []
    if header:
        parts.append(
            "% Generated by AI-Hydro — https://github.com/AI-Hydro/AI-Hydro\n"
            "% Add to your LaTeX project: \\bibliography{citations}\n"
            "% Cite the platform: \\cite{aihydro2026,aihydro_tools2026}\n"
        )
    parts.extend(entries)
    return "\n\n".join(parts) + "\n"


def all_known_keys() -> list[str]:
    """Return all known citation keys (for testing and documentation)."""
    return list({**BIBTEX_ENTRIES, **_PLUGIN_ENTRIES}.keys())
