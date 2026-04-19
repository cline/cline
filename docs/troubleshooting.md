---
description: Fix common AI-Hydro problems — MCP server not detected, tool errors, Python environment issues, and platform-specific fixes.
---

# Troubleshooting

---

## Start here — run the diagnostic

Before anything else, run:

```bash
aihydro-mcp --diagnose
```

Or if `aihydro-mcp` is not on your PATH:

```bash
python -m ai_hydro.mcp --diagnose
```

This checks every core and optional module, lists all registered tools, and confirms whether the executable is on PATH. The output tells you exactly what is missing and what to install.

---

## MCP Server Not Detected by the Extension

### Symptom

The extension loads but hydrological tools are unavailable. The MCP panel shows no `ai-hydro` server, or the server appears but lists 0 tools.

### What the extension does

On startup, the extension searches for `aihydro-mcp` in this order:

1. `which aihydro-mcp` (PATH lookup)
2. Common pip install locations — `~/.local/bin/`, `/opt/miniconda3/bin/`, `~/miniconda3/bin/`, `~/anaconda3/bin/`, `/opt/homebrew/bin/` (macOS/Linux) or `%APPDATA%\Python\PythonXXX\Scripts\` (Windows)
3. `python -m ai_hydro.mcp` — tries `python3` then `python`
4. If nothing is found — shows a one-time install notification

If step 3 succeeds, the server is registered using the module fallback (`python -m ai_hydro.mcp`), which works regardless of PATH.

### Fixes

**Option A — Register manually:**

```bash
python setup_mcp.py --ide vscode
```

This writes the correct server entry to `aihydro_mcp_settings.json` using whichever Python it finds.

**Option B — Use the full executable path:**

Find where pip installed the script:

```bash
# macOS/Linux
which aihydro-mcp || find ~/.local /opt/miniconda3 ~/miniconda3 -name aihydro-mcp 2>/dev/null

# Windows
where aihydro-mcp
```

Then open the MCP settings file at:

```
~/Library/Application Support/Code/User/globalStorage/aihydro.ai-hydro/settings/aihydro_mcp_settings.json
```

And set the `command` field to the full absolute path.

**Option C — Reinstall to a location the extension can find:**

```bash
# Activate your conda env first, then install
conda activate <your-env>
pip install aihydro-tools[all]
python setup_mcp.py --ide vscode
```

---

## `aihydro-mcp` Not Found After Install

### Symptom

```
command not found: aihydro-mcp
```

### Cause

pip placed the script outside your shell's `PATH`. This is common with user-level pip installs (no `sudo`).

### Fix

Use the module fallback — it always works:

```bash
python -m ai_hydro.mcp
```

To fix PATH permanently, find the scripts directory and add it:

| Install method | Typical location |
|---|---|
| `pip install --user` (macOS/Linux) | `~/.local/bin/` |
| Conda | `~/miniconda3/bin/` or `~/anaconda3/bin/` |
| Homebrew Python | `/opt/homebrew/bin/` |
| Windows user pip | `%APPDATA%\Python\Python3XX\Scripts\` |

```bash
# Add to ~/.zshrc or ~/.bashrc (replace path with your actual location)
export PATH="$HOME/.local/bin:$PATH"
```

---

## Tool Returns a DEPENDENCY_ERROR

### Symptom

A tool call returns:

```json
{"error": true, "code": "DEPENDENCY_ERROR", "message": "...", "recovery": "pip install ..."}
```

### Cause

The tool's optional dependencies were not installed. Most tools require specific extras.

### Fix

Install the relevant extra:

| Tools affected | Extra to install |
|---|---|
| `fetch_streamflow_data`, `fetch_forcing_data`, `fetch_camels_us` | `pip install aihydro-tools[data]` |
| `delineate_watershed`, `extract_hydrological_signatures`, `extract_geomorphic_parameters`, `compute_twi`, `create_cn_grid` (NLCD + Polaris are accessed inside `create_cn_grid`) | `pip install aihydro-tools[analysis]` |
| `train_hydro_model`, `get_model_results` | `pip install aihydro-tools[modelling]` |
Or install everything at once:

```bash
pip install aihydro-tools[all]
```

---

## `extract_geomorphic_parameters` Fails on Python 3.13

### Symptom

```
ImportError: geomorphic analysis requires: pip install aihydro-tools[analysis]
```

...even though `aihydro-tools[analysis]` is installed.

### Cause

`xrspatial` (used for slope computation in the geomorphic tool) is not currently installable via pip on **Python 3.13** due to an upstream packaging issue. The analysis extra installs, but `xrspatial` silently fails, causing the tool to error at runtime.

### Fix

**Option A — Install via conda (recommended):**

```bash
conda install -c conda-forge xarray-spatial
```

**Option B — Use Python 3.10–3.12:**

All analysis tools work fully on Python 3.10, 3.11, and 3.12.

!!! note
    The `compute_twi` tool is **not affected** — it uses `pysheds` for flow accumulation and slope, which installs correctly on all supported Python versions.

---

## LSTM Model Fails — Missing Static Attributes

### Symptom

`train_hydro_model` with `framework="neuralhydrology"` errors or returns poor results citing missing static attributes.

### Cause

The NeuralHydrology LSTM uses CAMELS static catchment attributes for the 671 CAMELS-US gauges. Outside this set, static attribute embedding is unavailable.

### Fix

For **CAMELS-671 gauges**, CAMELS attributes are fetched automatically — ensure `fetch_streamflow_data` has been called and the gauge is in the CAMELS-US benchmark set.

For **non-CAMELS gauges**, use `framework="hbv"` — the differentiable HBV-light model has no CAMELS dependency and works for any USGS gauge in CONUS.

---

## MCP Settings File Contains Invalid JSON

### Symptom

The extension loads but MCP tools are unavailable. No server appears in the MCP panel.

### Cause

The settings file may have been manually edited and left with a syntax error.

### Fix

Open and validate the file:

```
~/Library/Application Support/Code/User/globalStorage/aihydro.ai-hydro/settings/aihydro_mcp_settings.json
```

The file must be valid JSON. The minimal valid structure is:

```json
{
  "mcpServers": {}
}
```

To re-register the server from scratch, delete the `"ai-hydro"` entry (or the whole file) and reload the extension — it will auto-detect and re-register on startup.

---

## Python Environment Mismatch

### Symptom

`aihydro-mcp --diagnose` passes, but the VS Code extension cannot find the tools. Or: the wrong Python is being used by the extension.

### Cause

`aihydro-tools` is installed in one Python environment (e.g., a conda env) but the extension is finding a different Python (e.g., system Python) that does not have it installed.

### Fix

Register the server using the explicit Python from your conda env:

```bash
# Activate your env first
conda activate <your-env>

# Then register — setup_mcp.py uses the active Python
python setup_mcp.py --ide vscode
```

Or set the server command manually in the MCP settings file to use the full conda Python path:

```json
{
  "mcpServers": {
    "ai-hydro": {
      "command": "/opt/miniconda3/envs/your-env/bin/python",
      "args": ["-m", "ai_hydro.mcp"],
      "cwd": "/Users/you/.aihydro/cache"
    }
  }
}
```

---

## Write Errors / Read-Only Filesystem

### Symptom

The MCP server fails to start or crashes with a permission or read-only filesystem error. Common when the project is in a cloud-synced folder (Box Drive, OneDrive, iCloud Drive).

### Cause

Some cloud sync clients (notably Box Drive) mark synced directories as read-only at the OS level. The MCP server needs to write cache and temp files.

### How AI-Hydro handles this

The server automatically redirects all cache and temp writes to `~/.aihydro/cache/` on startup — this directory is always on local disk, outside any sync folder. If you see this error, it means the server is not starting at all (it crashes before the redirect).

### Fix

Ensure the server starts with its working directory set to local disk. If using `setup_mcp.py`, this is handled automatically. If configuring manually, add `"cwd"` to the server entry:

```json
{
  "mcpServers": {
    "ai-hydro": {
      "command": "aihydro-mcp",
      "args": [],
      "cwd": "/Users/you/.aihydro/cache"
    }
  }
}
```

Replace `/Users/you/` with your home directory path.

---

## Windows-Specific Issues

### `aihydro-mcp` not found despite being installed

Windows pip installs the script to `%APPDATA%\Python\Python3XX\Scripts\`, which is often not on `PATH`. The extension checks this location automatically during startup, but the terminal may not find it.

Use the module form in the terminal:

```cmd
python -m ai_hydro.mcp --diagnose
```

### PowerShell execution policy blocks the script

```powershell
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
```

### WSL users

Install `aihydro-tools` inside WSL (not on Windows), using the WSL Python. The extension must also run inside WSL for the paths to match.

---

## Still stuck?

Run `aihydro-mcp --diagnose`, copy the output, and open an issue at [github.com/AI-Hydro/AI-Hydro/issues](https://github.com/AI-Hydro/AI-Hydro/issues) with the `bug` label.
