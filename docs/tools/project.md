# Project, Literature & Persona Tools

Tools for multi-basin project management, literature synthesis, and researcher memory.

---

## Project Tools

### `start_project`

Create or resume a named research project.

| Parameter | Type | Description |
|-----------|------|-------------|
| `name` | str | Project name (used as directory name) |
| `description` | str | Optional — project scope and goals |
| `topics` | list[str] | Optional — topic tags, e.g. `["LSTM", "ungauged basins"]` |

Unlike sessions (which are tied to a specific study), a project can cover any hydrological topic — ungauged basins, remote sensing, global datasets, conceptual work — with no data source required.

```
Start a project called "Pacific Northwest Basins" focused on
snowmelt-driven runoff across Oregon and Washington.
```

---

### `get_project_summary`

Return an overview of the active project: associated sessions, computation status, journal, and literature index.

```
Give me a summary of my New England Basins project.
```

---

### `add_session_to_project`

Associate a research session with a project.

| Parameter | Type | Description |
|-----------|------|-------------|
| `session_id` | str | Research session identifier (any string) |
| `project_name` | str | Project name |

Sessions can represent USGS gauges, GRDC stations, ungauged basins, remote-sensing studies, or anything else.

---

### `search_experiments`

Full-text search across all research sessions in a project.

| Parameter | Type | Description |
|-----------|------|-------------|
| `query` | str | Search terms |
| `project_name` | str | Project name |
| `compare_sessions` | bool | Optional — include a side-by-side metric comparison (default: False) |

```
Which sessions in my project have a baseflow index above 0.6?
Show me all basins where I ran the LSTM model.
Which sessions have missing streamflow data?
```

---

## Literature Tools

### `index_literature`

Scan the project's `literature/` folder and build a searchable text index. Supports PDF (via pypdf/pdfplumber), txt, and md files.

| Parameter | Type | Description |
|-----------|------|-------------|
| `project_name` | str | Optional — defaults to active project |

Re-run after adding new files to refresh the index.

---

### `search_literature`

Query the literature index and return matching excerpts.

| Parameter | Type | Description |
|-----------|------|-------------|
| `query` | str | Search terms |
| `project_name` | str | Optional — defaults to active project |
| `return_full_content` | bool | Return full document text (default: False) |

```
What do my papers say about the role of soil depth in controlling BFI?
Find papers that use the Eckhardt filter for baseflow separation.
```

---

### `add_journal_entry`

Log a timestamped research note to the project journal.

| Parameter | Type | Description |
|-----------|------|-------------|
| `entry` | str | Note text |
| `project_name` | str | Optional |

```
Log: HBV significantly outperforms LSTM on the smaller basins — likely
due to limited training data in short-record gauges.
```

---

## Persona Tools

### `get_researcher_profile`

Return the persistent researcher profile — expertise, preferred models, active project, communication style, and accumulated observations.

Called automatically at the start of each conversation to personalise agent behaviour.

```
Show me my researcher profile.
```

---

### `update_researcher_profile`

Update one or more profile fields.

| Updateable fields | |
|---|---|
| `name`, `institution`, `role` | Identity |
| `domain`, `expertise` | Research domain |
| `preferred_models` | e.g., `["HBV-light", "LSTM"]` |
| `research_focus` | Current focus statement |
| `active_project` | Active project name |
| `communication_style` | e.g., `"concise, technical"` |
| `tools_familiarity` | Dict of tool → skill level |

```
Update my research focus to: investigating groundwater-surface water
interactions in semi-arid basins using isotope tracers.
```

---

### `log_researcher_observation`

Record an observation about the researcher's evolving preferences (typically called by the agent automatically, not by the user directly).

```json
{
  "observation": "Consistently requests KGE alongside NSE for model evaluation. Prefers validation NSE > 0.75 as acceptance threshold."
}
```

Observations accumulate up to 20 entries; oldest are pruned automatically.
