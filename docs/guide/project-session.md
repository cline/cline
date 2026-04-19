---
description: AI-Hydro ProjectSession — organise multi-gauge research, run cross-session experiment search, and keep a project-level journal across many studies.
---

# Project Workspace

A `ProjectSession` organises research that spans multiple gauges, regions, or topics — not tied to a single USGS gauge ID.

---

## Why Projects?

HydroSession is gauge-centric. That works well for deep single-basin analysis, but research often involves:

- Comparing hydrology across 10 CAMELS catchments
- Running the same modelling workflow on all gauges in a region
- Tracking which gauges have been calibrated and which haven't
- Connecting analysis results to the papers that motivated them

`ProjectSession` is the container that holds all of this together.

---

## Storage

```
~/.aihydro/projects/<project_name>/
├── project.json          ← project state, gauge list, journal
└── literature/           ← folder for PDF/txt/md literature files
    ├── literature_index.md
    └── *.pdf, *.txt, *.md
```

---

## Creating a Project

```
Start a new project called "New England Basins" focused on comparing
snowmelt-driven runoff across Maine and New Hampshire catchments.
```

The agent calls `start_project("New England Basins", description="...")` and confirms the project is active.

---

## Adding Gauges

```
Add gauges 01031500, 01013500, and 01054200 to the project.
```

Each call to `add_gauge_to_project` links an existing HydroSession (or creates a placeholder) to the project. The project then tracks what has been computed for each.

---

## Project Summary

```
Give me a summary of the New England Basins project.
```

`get_project_summary` returns:

- List of gauges and their computation status
- Recent journal entries
- Literature index status
- Any saved metrics or comparison results

---

## Cross-Session Search

One of the most powerful features — search across all gauge sessions in a project:

```
Which gauges in my project have a baseflow index above 0.6?
```

```
Show me all basins where I've run the LSTM model.
```

```
Which gauges have streamflow data from before 1990?
```

`search_experiments` runs a full-text search across all stored session results and returns matching gauge IDs with excerpts.

---

## Journal

The project journal is a timestamped log of experiment notes — decisions made, anomalies observed, hypotheses formed.

```
Log a journal entry: HBV performed significantly better on the smaller basins.
May be related to the prevalence of lakes in the larger ones.
```

```json title="project.json journal excerpt"
{
  "journal": [
    {
      "timestamp": "2026-04-10T14:22:00Z",
      "entry": "HBV performed significantly better on the smaller basins. May be related to the prevalence of lakes in the larger ones."
    }
  ]
}
```

Retrieve recent entries:

```
What have I noted in the journal for this project?
```

---

## Next: Literature Module

→ [Literature Module](literature.md) — index your PDF collection and let the agent synthesise across it.
