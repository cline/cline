---
description: The AI-Hydro HTML Preview panel — a built-in Jupyter-like execution environment for interactive HTML artifacts, learning modules, and data dashboards inside VS Code.
---

# HTML Preview Panel

The AI-Hydro HTML Preview panel renders any HTML file inside VS Code with a full **built-in Python kernel** — no browser needed, no Jupyter server to start. Think of it as a lightweight, self-contained notebook environment embedded directly in the editor: the AI writes an interactive artifact, it opens automatically, and you can run Python cells, explore visualisations, and interact with sliders and quizzes without leaving VS Code.

---

## What It Is For

The HTML Preview panel is designed for three main artifact types:

| Artifact | Description |
|---|---|
| **Interactive learning modules** | Self-contained HTML files that combine prose, equations, executable Python cells, JS visualisations, and quizzes on a single hydrology topic |
| **Data dashboards** | Analysis results rendered as interactive widgets — Plotly charts, map insets, slider-controlled parameter sweeps |
| **Standalone reports** | Provenance-tracked research outputs that degrade gracefully in a plain browser |

When the agent creates any of these using the `interactive-module-builder` skill, the file opens in the panel automatically — no drag-and-drop required.

---

## Opening the Panel

**Automatic:** Any HTML file containing the AI-Hydro module manifest block (`<script type="application/vnd.aihydro.module+json">`) opens in the panel automatically when the agent writes or saves it.

**Manual — toolbar:** Click the **HTML Preview** button (`⊞` icon) in the AI-Hydro sidebar.

**Manual — command palette:** Run `AI-Hydro: Open HTML Preview`.

**Manual — drag-and-drop:** Drag any `.html` file from the Explorer onto the panel once it is open.

The panel opens as a split view alongside the chat column.

---

## Panel Layout

```
┌────────────────────────────────────────────────────────────┐
│ Sidebar (module list)  │  Toolbar                          │
│                        ├───────────────────────────────────│
│ [Module A]  ←active    │  iframe (rendered HTML)           │
│ [Module B]             │                                   │
│                        │                                   │
│ + Add  Clear all       │                                   │
└────────────────────────┴───────────────────────────────────┘
```

### Sidebar

The left sidebar lists every loaded module as a compact card showing the module title and its last two path segments. Click a card to switch to that module. The active card is highlighted with a left accent border.

- **+ Add** — open a file picker to load any `.html` file
- **Clear all previews** — close all loaded modules (appears only when at least one is loaded)
- **×** on each card — close that module individually

### Toolbar

The toolbar is a single row of icon buttons organised into four groups:

| Group | Buttons | Purpose |
|---|---|---|
| **Identity** | Collapse ▼, title, file path | Collapse to minimal strip; shows module title and relative path |
| **Run controls** | ▶ ▶▶ ⟳▶ ■ ⌫ | Execute cells (see below) |
| **Kernel** | Status chip, env selector, ↻ envs, ⟳ kernel, 🔬 probe, ⚙ diagnostics | Kernel management |
| **File ops** | ⎘ copy path, 📄 open in editor, ↻ reload, ↗ browser, × close | File actions |

Collapse the toolbar to a 28px strip (title + status chip + stop button) to maximise iframe space.

---

## Run Controls

| Button | Icon | Action |
|---|---|---|
| **Run cell** | `▶` | Run the focused cell (or the first cell if none focused) |
| **Run all** | `▶▶` | Execute all Python cells top-to-bottom |
| **Restart & run all** | `⟳▶` | Restart the kernel (clears all variables) then run all cells — clean-slate execution |
| **Stop** | `■` | Interrupt the running cell (turns red when execution is in progress) |
| **Clear outputs** | `⌫` | Wipe all cell output areas; kernel memory is unchanged |

All run controls require **workspace trust** to be enabled and at least one Python cell to be detected in the HTML file.

---

## Kernel Status Chip

The animated pill next to the run group shows the current kernel state at a glance:

| Colour | Label | Meaning |
|---|---|---|
| 🟢 Green | **Ready** | Kernel is idle and clean (no cells executed since last restart) |
| 🟡 Amber + ✎ | **Ready** | Kernel is idle but has executed cells — variables are in memory |
| 🔵 Blue (pulsing) | **Busy** / **Busy 2/5** | Cell is executing; progress shown when running all cells |
| 🟡 Amber (pulsing) | **Starting** | Kernel is starting up |
| 🔴 Red | **Error** | Kernel encountered an unrecoverable error |
| ⚫ Grey | **Stopped** / **Idle** | No kernel attached |

Hover the chip for detailed tooltip: kernel label, interpreter path, Python version, last error if any.

---

## Python Environment

The dropdown in the **Kernel group** selects which Python interpreter starts the kernel.

### Setting up an environment

The recommended approach is to let the agent create a virtual environment in your workspace:

```
"Set up a Python environment with numpy, matplotlib, and geopandas for my module"
```

The agent will create `.aihydro/venv/`, install packages, and the new environment will appear in the dropdown after you click **↻ Refresh environments**.

### Probe environment

Click the 🔬 (beaker) button to run a quick capability check that reports which packages are installed: `numpy`, `pandas`, `matplotlib`, `rasterio`, and others. Results appear in the diagnostics panel.

### Shared vs. per-artifact kernels

By default each artifact gets its own isolated kernel session — variables from Module A do not bleed into Module B. To share a kernel across artifacts, set `aihydro.htmlPreview.shareKernelAcrossArtifacts: true` in VS Code settings.

---

## File Operations

| Button | Action |
|---|---|
| ⎘ Copy path | Copy the full file path to the clipboard; button briefly shows ✓ |
| 📄 Open in editor | Open the source `.html` file in the VS Code text editor |
| ↻ Reload | Force a full iframe reload (useful after external edits) |
| ↗ Open in browser | Open the file in your default system browser |
| × Close | Remove this module from the preview; does not delete the file |

---

## Workspace Trust

Python execution is gated by VS Code's workspace trust system. If the workspace is not trusted:

- A yellow banner appears at the top of the toolbar
- All run controls are disabled
- The status chip shows its idle state

To enable Python execution, open the VS Code command palette and run **Workspaces: Manage Workspace Trust**, then trust the current folder.

---

## `show_html_preview` MCP Tool

The agent can open any HTML file in the panel programmatically:

```python
show_html_preview(file_path="/abs/path/to/module.html")
```

This is called automatically by the `interactive-module-builder` skill after writing a new module. You can also call it manually in the chat:

```
"Open /path/to/my-dashboard.html in the HTML Preview"
```

---

## Auto-Open Manifest

Any HTML file containing the AI-Hydro module manifest block is detected and opened automatically:

```html
<head>
  <script type="application/vnd.aihydro.module+json">
  {
    "id": "baseflow-separation",
    "title": "Baseflow Separation Methods",
    "version": "0.1.0",
    "authors": [{ "name": "AI-Hydro Agent" }],
    "requires": { "executable": true, "python": ["numpy", "matplotlib"] }
  }
  </script>
</head>
```

The manifest is also what the Skills marketplace uses to identify module artifacts. See [Interactive Module Cell Format](../html-preview-cells.md) for the full cell markup contract.

---

## Diagnostics Panel

Click the ⚙ gear button to toggle the diagnostics panel below the iframe. It shows:

- Kernel start log and interpreter path
- Environment probe results
- Execution error tracebacks
- Any `console.error` / `console.warn` calls from the HTML page

The panel is collapsed by default and does not affect iframe layout.

---

## Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| `Shift+Enter` | Run focused cell |
| `Ctrl+Shift+Enter` | Run all cells |
| `Escape` | Stop execution |

Shortcuts only fire when focus is inside the preview iframe.

---

## Roadmap

- **Cell dependency graph** — `dependsOn` field in cell JSON metadata will allow graph-ordered execution
- **Variable inspector** — inspect Python variables in the kernel without writing `print()` calls
- **Multi-band GeoTIFF in cells** — render raster outputs inline in the output area
- **Shared output store** — pass data between cells in different artifacts
