# Installation Guide

## Requirements

| Requirement | Minimum version | Notes |
|-------------|----------------|-------|
| VS Code | 1.84 | Required for the extension |
| Python | 3.10 | 3.11 or 3.12 recommended |
| pip / conda | any | For Python package installation |
| AI API key | — | Anthropic, OpenAI, Google, etc. |

---

## 1. Install the VS Code Extension

### Option A — Install from `.vsix` (recommended for alpha)

1. Download the latest `ai-hydro-*.vsix` from the [Releases page](https://github.com/AI-Hydro/AI-Hydro/releases).
2. Open VS Code.
3. Go to **Extensions** (`Ctrl+Shift+X` / `Cmd+Shift+X`).
4. Click the `...` menu (top-right of Extensions panel) → **Install from VSIX…**
5. Select the downloaded `.vsix` file.
6. Reload VS Code when prompted.

### Option B — Build from Source

```bash
# Prerequisites: Node.js 18+, npm
git clone https://github.com/AI-Hydro/AI-Hydro.git
cd AI-Hydro

# Install all dependencies (extension + webview)
npm run install:all

# Build the .vsix package
npm run package
# → produces ai-hydro-1.0.0-alpha.vsix in the current directory
```

Then install the generated `.vsix` using Option A above.

---

## 2. Install the Python MCP Server

The Python package provides the hydrological tools. It must be installed in the same Python environment that will run the MCP server.

### Install the package

```bash
cd AI-Hydro/python
pip install -e .
```

This installs `ai-hydro` in editable mode along with all required dependencies:

| Group | Packages |
|-------|---------|
| Core | numpy, pandas, xarray, scipy |
| Geospatial | geopandas, rasterio, shapely, pyproj |
| Hydro data | pygeohydro, pynhd, py3dep, pygridmet |
| Modelling | torch, hydrodl2 |
| MCP server | mcp[cli] |

> **Conda users (recommended):**
> ```bash
> conda create -n aihydro python=3.11
> conda activate aihydro
> pip install -e AI-Hydro/python
> ```

### Register the MCP server

Run the setup script to write the server configuration into your extension's settings:

```bash
# For the AI-Hydro VS Code extension (default)
python setup_mcp.py --ide vscode

# For the Cline VS Code extension
python setup_mcp.py --ide cline

# For Claude Code CLI
python setup_mcp.py --ide claude-code
```

This writes an entry like the following into the extension's `aihydro_mcp_settings.json`:

```json
{
  "mcpServers": {
    "ai-hydro": {
      "command": "/path/to/python",
      "args": ["/path/to/AI-Hydro/python/mcp_server.py"],
      "cwd": "/Users/you/.aihydro/cache"
    }
  }
}
```

### Verify the installation

```bash
python setup_mcp.py --check
```

Expected output:
```
[OK] Server starts successfully
[OK] 15 tools registered:
     delineate_watershed, fetch_streamflow_data, extract_hydrological_signatures,
     extract_geomorphic_parameters, compute_twi, create_cn_grid,
     fetch_forcing_data, train_hydro_model, get_model_results,
     start_session, get_session_summary, clear_session, add_note,
     export_session, sync_research_context
```

---

## 3. Configure an AI Provider

1. Click the **AI-Hydro icon** (beaker / robot) in the VS Code Activity Bar.
2. Click the **gear icon** (Settings) at the top of the panel.
3. Choose your provider from the dropdown and paste your API key.
4. Click **Save**.

Recommended providers and models:

| Provider | Model | Notes |
|----------|-------|-------|
| Anthropic | `claude-sonnet-4-6` | Best for complex research tasks |
| OpenAI | `gpt-4o` | Fast, good tool use |
| Google | `gemini-2.0-flash` | Cost-effective |
| Ollama | Any local model | Fully offline; tool use quality varies |

---

## 4. Platform Notes

### macOS
- Python from Miniconda works best (avoids system Python issues).
- The MCP server config is stored in `~/Library/Application Support/Code/User/globalStorage/aihydro.ai-hydro/settings/`.
- Box Drive / iCloud folders are read-only at the OS level; the server automatically uses `~/.aihydro/cache/` as its working directory.

### Linux
- Extension settings are in `~/.config/Code/User/globalStorage/aihydro.ai-hydro/settings/`.
- `setup_mcp.py` detects Linux automatically.

### Windows
- Settings path: `%APPDATA%\Code\User\globalStorage\aihydro.ai-hydro\settings\`
- Use WSL2 with a Linux Python environment for the most reliable experience.
- `setup_mcp.py` Windows support is in progress.

---

## Troubleshooting

### "Server failed to start" in the MCP panel

```bash
# Check which Python is being used
python setup_mcp.py --check

# Re-run registration with explicit Python path
python setup_mcp.py --ide vscode --python /usr/local/bin/python3
```

### Import errors at startup

```bash
pip install -e "AI-Hydro/python[.]"  # reinstall with all extras
```

### `delineate_watershed` returns "No data"

- Verify the gauge ID is a valid 8-digit USGS NWIS site number (e.g., `01031500`).
- Check internet connectivity — the tool calls USGS NLDI and NHDPlus REST APIs.

### Segfault after model training (exit code 139)

This is a known harmless cleanup issue in some PyTorch versions. Results are saved to the session before the crash. Upgrade PyTorch to 2.3+ to resolve.

---

## Updating

```bash
cd AI-Hydro
git pull
pip install -e python/    # picks up any new dependencies
python python/setup_mcp.py --ide vscode   # re-register if tool list changed
```

Then rebuild and reinstall the `.vsix` if extension TypeScript changed:
```bash
npm run install:all && npm run package
```
