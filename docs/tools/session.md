# Session Tools

Tools for managing per-gauge research sessions, exporting results, synchronising context, and discovering available tools.

See [Sessions & Provenance](../guide/sessions.md) for a full explanation of how the session system works.

---

## `start_session`

Initialise or resume a research session for a USGS gauge.

| Parameter | Type | Description |
|-----------|------|-------------|
| `gauge_id` | str | USGS gauge ID |
| `workspace_dir` | str (optional) | Absolute path to the VS Code workspace folder |

If a session already exists, it is loaded without clearing any cached results. Calling `start_session` on an existing session is safe and idempotent.

The response includes:

- `site_name` — LLM-set display name for this session (set via `sync_research_context`)
- `has_interpretation` — whether a scientific interpretation has been authored yet
- `mcp_python` — the Python interpreter running the MCP server
- `mcp_pip` — corresponding pip path
- `available_packages` — dict of `{package_name: version}` for all installed packages

This makes it safe to write Python scripts without guessing interpreter paths or assuming what is installed.

---

## `get_session_summary`

Return an overview of all computed and pending analysis slots for a gauge.

| Parameter | Type | Description |
|-----------|------|-------------|
| `gauge_id` | str | USGS gauge ID |

**Example output:**
```
Session: 01031500
✓ watershed      — 1,247 km², delineated 2026-04-10
✓ streamflow     — 2000–2024, 9,131 records
✓ signatures     — 15 statistics computed
✓ geomorphic     — 28 parameters
○ twi            — not computed
○ cn             — not computed
✓ forcing        — GridMET 2000–2024
✓ camels         — attributes extracted
✓ model          — HBV-light, NSE val: 0.79
```

---

## `clear_session`

Reset one or more slots, or the entire session.

| Parameter | Type | Description |
|-----------|------|-------------|
| `gauge_id` | str | USGS gauge ID |
| `slots` | list[str] | Optional — list of slot names to clear (e.g., `["streamflow", "signatures"]`). Omit to clear all. |

```
Clear the streamflow slot for gauge 01031500 — I want to re-fetch with
a longer date range starting from 1980.
```

!!! warning
    Clearing a slot removes the cached result permanently. Dependent computations (e.g., signatures depend on streamflow) will need to be re-run.

---

## `add_note`

Attach a free-text research note to the session.

| Parameter | Type | Description |
|-----------|------|-------------|
| `gauge_id` | str | USGS gauge ID |
| `note` | str | Note text |

Notes are stored in the session JSON and appear in `get_session_summary`. Use them for hypotheses, anomalies, or decisions you want the agent to recall later.

```
Note for 01031500: The high BFI is consistent with the fractured bedrock
geology visible in the NLCD. Worth investigating with isotope data.
```

---

## `export_session`

Export the session as a citable methods paragraph, JSON data file, or BibTeX references.

| Parameter | Type | Description |
|-----------|------|-------------|
| `gauge_id` | str | USGS gauge ID |
| `format` | str | `"json"` (default), `"methods"` (prose paragraph), or `"bibtex"` |

Output is written to disk at `~/.aihydro/sessions/<gauge_id>_export.<ext>` to preserve the context window.

**Text export example:**
```
Watershed boundaries for USGS gauge 01031500 were delineated using the
NHDPlus dataset via the USGS NLDI API (USGS, 2024), accessed 2026-04-10.
Daily streamflow records (2000–2024) were retrieved from the USGS National
Water Information System (USGS NWIS). Hydrological signatures were computed
following Addor et al. (2018). Climate forcing data were obtained from the
GridMET dataset (Abatzoglou, 2013). A differentiable HBV-light model was
calibrated using the differentiable HBV-light implementation in aihydro-tools,
achieving NSE = 0.79 on the validation period (2018–2024).
```

---

## `sync_research_context`

Two-phase tool for generating a **LLM-authored scientific interpretation** of the current session and embedding it into `.aihydrorules/research.md` for automatic context injection.

`research.md` has two sections:

- **Skeleton** (Python-generated, always current) — site identity, computed/pending slots, researcher notes
- **Scientific context** (LLM-authored) — basin behaviour, cross-slot patterns, anomalies, research priorities

The skeleton is refreshed automatically on every tool call. The scientific context is only written when you explicitly call this tool.

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `gauge_id` | str | Yes | USGS gauge ID |
| `interpretation` | str | No | Your scientific prose summary (Phase 2) |
| `site_name` | str | No | Short descriptive slug for this session, e.g. `"piscataquis-surface-flow-2000-2020"` |

**Workflow — call twice:**

**Phase 1** — call with only `gauge_id`. Returns `session_data` containing all computed slot values (every key from every slot, not a template summary). Read it, reason about patterns and contradictions, then:

**Phase 2** — call again with `interpretation` (3–6 sentences of scientific prose) and `site_name`. Stored in the session and embedded in `research.md` immediately. Every future conversation opens with your understanding pre-loaded.

```
# Phase 1: retrieve raw session data
sync_research_context('01031500')

# Phase 2: store your interpretation
sync_research_context(
    '01031500',
    site_name='piscataquis-surface-flow-2000-2020',
    interpretation='The Piscataquis shows surface-flow dominance (BFI=0.16) ...'
)
```

!!! tip
    Call this after any major analysis milestone (e.g., after `extract_hydrological_signatures`, after `train_hydro_model`). The interpretation accumulates across calls — each Phase 2 overwrites the previous interpretation, so write a complete summary each time.

---

## `list_available_tools`

Return all registered MCP tools with names, descriptions, and parameter schemas.

No parameters required.

This is the runtime source of truth for available capabilities — it includes both built-in tools and any community plugin tools discovered via the `aihydro.tools` entry point. Always prefer this over documentation for an accurate picture of what is installed.

```
What tools do I have available?
```

**Returns:**
- `tools` — list of `{name, description, parameters}` dicts
- `n_tools` — total count
- `mcp_python` — interpreter running the server
- `note` — how to install additional community plugins
