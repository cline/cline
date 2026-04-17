# AI-Hydro Use-Case Test Prompts

A curated set of prompts for manually testing the AI-Hydro platform end-to-end.
Each prompt is self-contained and tests a specific capability or workflow path.

Use these in the VS Code extension chat window with the AI-Hydro MCP server running.

---

## 1. Session Bootstrap

**Purpose:** Verify session creation, Python env exposure, and workspace wiring.

```
Start a new research session for USGS gauge 01031500 and tell me:
1. What Python interpreter is the MCP server using?
2. Which key hydrological packages are installed and what versions?
3. What analysis slots are pending?
```

**Expected behaviour:**
- Calls `start_session("01031500")`
- Reports `mcp_python` path, lists key packages from `available_packages`
- Lists all 8 pending slots (watershed, streamflow, signatures, geomorphic, twi, cn, forcing, model)

---

## 2. Tool Discovery

**Purpose:** Verify `list_available_tools` returns accurate runtime list.

```
Call list_available_tools() and return the complete list of tool names exactly as registered —
do not summarize, group, or paraphrase. Show name and one-line description for each.
```

**Expected behaviour:**
- Calls `list_available_tools()`
- Returns all 27 tool names verbatim (including `list_available_tools` and `get_library_reference`)
- Reports total count (≥27)
- Does NOT paraphrase, group, or omit any tools
- Does NOT hallucinate tools that aren't registered (e.g., `extract_camels_attributes` must NOT appear)

---

## 3. Full Gauge Analysis Pipeline

**Purpose:** Test the end-to-end 8-step analysis workflow.

```
Run a complete hydrological analysis for USGS gauge 01031500 (Piscataquis River, Maine).
Use my current workspace folder as the output directory.
Date range: 2000-01-01 to 2020-12-31.
Tell me the key findings at each step.
```

**Expected behaviour:**
- Calls each tool in sequence: `delineate_watershed` → `fetch_streamflow_data` →
  `extract_hydrological_signatures` → `extract_geomorphic_parameters` →
  `compute_twi` → `fetch_forcing_data`
- Summarises key numbers (area, BFI, mean Q, etc.) after each step
- Files auto-saved to workspace (geojson, hydrograph PNG, FDC PNG, maps)
- Does NOT call `extract_camels_attributes` — that tool no longer exists
- Does NOT skip to scripting

---

## 4. Named Session (session_id / gauge_id Separation)

**Purpose:** Verify the session_id / gauge_id separation — session_id can be any meaningful label.

```
Start a session called "piscataquis-snowmelt-2024" for USGS gauge 01031500,
delineate the watershed, then fetch streamflow from 2010-01-01 to 2024-12-31.
```

**Expected behaviour:**
- Calls `start_session("piscataquis-snowmelt-2024")` — NOT `start_session("01031500")`
- Calls `delineate_watershed("piscataquis-snowmelt-2024", gauge_id="01031500")`
- Calls `fetch_streamflow_data("piscataquis-snowmelt-2024", gauge_id="01031500", ...)`
- Session stored as `piscataquis-snowmelt-2024.json`, not `01031500.json`
- After delineation, `session.site_id = "01031500"` so subsequent tools don't need gauge_id again

---

## 5. Model Calibration

**Purpose:** Test the HBV-light modelling workflow.

```
For gauge 01031500 (run analysis first if not done), calibrate an HBV-light
hydrological model. Tell me the NSE, KGE, and RMSE on the validation period.
Is the model performance acceptable for publication?
```

**Expected behaviour:**
- Checks session for existing streamflow and forcing data
- Calls `train_hydro_model("01031500", framework="hbv", ...)`
- For CAMELS-671 gauges (01031500 is one), uses CAMELS benchmark streamflow automatically
- Reports NSE/KGE/RMSE and interprets them (NSE > 0.75 = excellent, 0.5–0.75 = satisfactory)
- Does NOT write its own HBV code

---

## 6. Library Reference Lookup

**Purpose:** Test `get_library_reference` prevents hallucination.

```
I want to write a Python script that fetches daily streamflow for gauge 01031500
using dataretrieval and converts it from cfs to m³/s. Before writing the script,
look up the dataretrieval library reference and tell me the exact column name
for daily discharge and the unit conversion factor.
```

**Expected behaviour:**
- Calls `get_library_reference("dataretrieval")` or `get_library_reference("pygeohydro")`
- Correctly reports the discharge column name and cfs → m³/s conversion (× 0.0283168)
- Uses `mcp_python` from session as the script interpreter
- Script uses the correct column name — not a hallucinated `"discharge"` or `"flow"`

---

## 7. Python Script with Correct Interpreter

**Purpose:** Test that agents use `mcp_python` and don't hallucinate the interpreter path.

```
Write me a Python script that:
1. Loads the streamflow JSON saved in my workspace for gauge 01031500
2. Computes a 7-day rolling mean
3. Saves the result as "q_rolling7.csv"

Make sure you use the correct Python interpreter.
```

**Expected behaviour:**
- Calls `start_session` to get `mcp_python`
- Shebang or subprocess call uses the actual path (e.g., `/opt/miniconda3/bin/python`)
- Does NOT use `#!/usr/bin/env python3` or a hardcoded `/usr/bin/python3`
- Does NOT call `pip install pandas` (it's already available)

---

## 8. Session Caching (Idempotency)

**Purpose:** Verify already-computed steps are skipped.

```
Run watershed delineation for gauge 01031500 again.
```

*(Run after Test 3 above so the slot is already computed.)*

**Expected behaviour:**
- Calls `delineate_watershed("01031500")` which returns cached result immediately
- Response includes `_cached: true`
- Does NOT re-fetch from NLDI
- Mentions that result is from cache and how to force re-run (`clear_session`)

---

## 9. Multi-Session Project

**Purpose:** Test project-level session management across gauges.

```
Create a project called "maine-rivers" and add three gauges to it:
01031500 (Piscataquis), 01013500 (Fish River), and 01029500 (Aroostook).
Then show me a summary of the project.
```

**Expected behaviour:**
- Calls `start_project("maine-rivers")`
- Calls `add_session_to_project` three times (NOT `add_gauge_to_project`)
- Calls `get_project_summary("maine-rivers")`
- Returns overview with all three sessions and their states

---

## 10. Literature Search

**Purpose:** Test folder-based literature indexing.

*(Requires a PDF or text file dropped into the project's `literature/` folder first.)*

```
Index the literature I've added to the maine-rivers project, then search for
anything about baseflow index or BFI in northeastern US catchments.
```

**Expected behaviour:**
- Calls `index_literature("maine-rivers")` — reports files indexed
- Calls `search_literature("maine-rivers", "baseflow index northeastern")` — returns excerpts
- Does NOT hallucinate citations not in the actual files

---

## 11. Session Export for Publication

**Purpose:** Test provenance export.

```
Export the full analysis for gauge 01031500 as a methods paragraph I can paste
into my paper's Methods section.
```

**Expected behaviour:**
- Calls `export_session("01031500", format="methods")`
- Returns a prose paragraph naming each tool, its data source, and the computed date
- File saved to workspace; paragraph included inline

---

## 12. Selective Cache Clear and Recompute

**Purpose:** Test that clearing one slot doesn't affect others.

```
I want to redo the hydrological signatures for gauge 01031500 using a longer
date range (1990-2020). Clear just the signatures and streamflow slots, then
re-fetch streamflow from 1990-01-01 to 2020-12-31 and recompute signatures.
```

**Expected behaviour:**
- Calls `clear_session("01031500", ["streamflow", "signatures"])`
- Response shows those two slots are now pending; watershed, geomorphic, etc. remain computed
- Calls `fetch_streamflow_data("01031500", "1990-01-01", "2020-12-31")`
- Calls `extract_hydrological_signatures("01031500")`
- Compares new signatures to previous values

---

## 13. Researcher Profile

**Purpose:** Test persona persistence.

```
I'm a PhD student in hydrology at the University of Maine, specialising in
cold-region hydrology and snowmelt-driven floods. Save this to my researcher profile.
```

**Then in a NEW conversation:**
```
What gauge should I start with to study spring freshet dynamics in Maine?
```

**Expected behaviour (session 1):**
- Calls `update_researcher_profile()` with the stated information

**Expected behaviour (session 2):**
- Calls `get_researcher_profile()` at conversation start
- Tailors recommendation to cold-region/snowmelt context (e.g., suggests gauges in northern Maine)
- Does NOT start from scratch or ask who the researcher is

---

## 14. Error Handling — Invalid Gauge

**Purpose:** Verify graceful error responses.

```
Delineate the watershed for gauge 00000000.
```

**Expected behaviour:**
- Calls `delineate_watershed("00000000")`
- Returns error dict with `error: true` and a meaningful message
- Does NOT crash or return an unformatted traceback
- Suggests checking the gauge ID at waterdata.usgs.gov

---

## 15. Community Plugin Discovery

**Purpose:** Test that installed plugins show up in `list_available_tools`.

*(Requires a plugin installed via `pip install <aihydro-plugin-package>`.)*

```
What tools are available? Are there any tools beyond the built-in ones?
```

**Expected behaviour:**
- Calls `list_available_tools()`
- Shows the plugin tool(s) alongside built-ins
- Reports plugin tool name, description, and parameters correctly

---

## 16. Knowledge Plugin Extension

**Purpose:** Test `get_library_reference` with a plugin-contributed library.

*(Requires a knowledge plugin installed that contributes a reference for e.g. `snowmodel`.)*

```
Look up the snowmodel library reference.
```

**Expected behaviour:**
- Calls `get_library_reference("snowmodel")`
- Returns the plugin-contributed gotchas and patterns
- If no plugin installed: returns `NOT_FOUND` with list of `available_refs`

---

## Regression Checklist

After any code change, verify these do NOT regress:

- [ ] `start_session` response always includes `mcp_python`, `mcp_pip`, `available_packages`
- [ ] `list_available_tools` returns exactly 27 built-in tools (≥27 with plugins)
- [ ] `extract_camels_attributes` does NOT appear in tool list
- [ ] `add_session_to_project` appears in tool list (NOT `add_gauge_to_project`)
- [ ] `get_library_reference("pynhd")` returns `gotchas` list with ≥1 item
- [ ] `get_library_reference("unknown_lib")` returns `error: true, code: NOT_FOUND, available_refs: [...]`
- [ ] `delineate_watershed("not_a_gauge")` returns `error: true`
- [ ] `delineate_watershed("piscataquis-2024", gauge_id="01031500")` succeeds (named session)
- [ ] All 34 `test_mcp_integration.py` tests pass (monorepo) / 74 pass (standalone)

---

## Test Run Log

### 2026-04-16 — v0.1.4 / aihydro-tools 1.3.0 (pre-CAMELS removal)

**Environment:**
- Extension: v0.1.4
- Python: `/opt/miniconda3/bin/python3` (3.13.2)
- aihydro-tools: 1.3.0 (editable install from `~/aihydro-tools/`)
- Gauge under test: `01031500` (Piscataquis River, Maine)

#### Test 1 — Session Bootstrap ✅

**Result:** PASS  
`start_session` correctly returned `mcp_python`, `mcp_pip`, `available_packages`. Session state showed pending slots correctly.

**Notes:**
- `ai-hydro 1.0.0` appeared in `available_packages` — ghost editable install from early dev. Remove with `pip uninstall ai-hydro`.

#### Test 2 — Tool Discovery ⚠️ PARTIAL PASS

**Result:** Tool registry worked (28 tools at the time), but agent summarized instead of returning verbatim list. Prompt has since been tightened.

#### Tests 3–15 — Not run

---

### 2026-04-17 — v0.1.5 / aihydro-tools 1.3.0 (post-CAMELS removal)

**Changes since last run:**
- `extract_camels_attributes` removed — 27 tools now
- `add_session_to_project` replaces `add_gauge_to_project`
- `fetch_streamflow_data` now uses `dataretrieval` (fixes pandas ≥2.2 crash)
- Named session_id / gauge_id separation enforced

**Status:** Tests pending
