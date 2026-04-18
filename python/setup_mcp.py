"""
AI-Hydro MCP Server Setup
==========================

Registers the AI-Hydro MCP server in your IDE's MCP settings so that
all hydrological tools are immediately available to AI agents.

Usage
-----
    python setup_mcp.py                          # auto-detect IDE
    python setup_mcp.py --ide vscode             # VS Code with AI-Hydro extension
    python setup_mcp.py --ide cline              # VS Code with Cline extension
    python setup_mcp.py --ide claude-code        # Claude Code (~/.claude/settings.json)
    python setup_mcp.py --check                  # verify server starts correctly
    python setup_mcp.py --remove                 # remove the server entry

Tools
-----
  Analysis (8):
    delineate_watershed, fetch_streamflow_data, extract_hydrological_signatures,
    extract_geomorphic_parameters, compute_twi, create_cn_grid, fetch_forcing_data,
    fetch_camels_us
  Session (6):
    start_session, get_session_summary, clear_session, add_note,
    export_session, sync_research_context
  Modelling (2):
    train_hydro_model, get_model_results
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

# ── Paths ─────────────────────────────────────────────────────────────────────

_HERE = Path(__file__).resolve().parent
_SERVER_KEY = "ai-hydro"

_MCP_SETTINGS_PATHS = {
    "vscode": (
        Path.home()
        / "Library/Application Support/Code/User/globalStorage"
        / "aihydro.ai-hydro/settings/aihydro_mcp_settings.json"
    ),
    "cline": (
        Path.home()
        / "Library/Application Support/Code/User/globalStorage"
        / "saoudrizwan.claude-dev/settings/cline_mcp_settings.json"
    ),
    "claude-code": Path.home() / ".claude" / "settings.json",
}

# Linux overrides
if sys.platform.startswith("linux"):
    _MCP_SETTINGS_PATHS["vscode"] = (
        Path.home()
        / ".config/Code/User/globalStorage"
        / "aihydro.ai-hydro/settings/aihydro_mcp_settings.json"
    )
    _MCP_SETTINGS_PATHS["cline"] = (
        Path.home()
        / ".config/Code/User/globalStorage"
        / "saoudrizwan.claude-dev/settings/cline_mcp_settings.json"
    )


def _get_server_command() -> tuple[str, list[str]]:
    """Return (command, args) for the MCP server.

    Prefers the ``aihydro-mcp`` console script (pip install mode).
    Falls back to ``python mcp_server.py`` (monorepo dev mode).
    """
    aihydro_mcp = shutil.which("aihydro-mcp")
    if aihydro_mcp:
        return aihydro_mcp, []
    # Fallback: run mcp_server.py directly
    server_py = _HERE / "mcp_server.py"
    if server_py.exists():
        return sys.executable, [str(server_py)]
    raise FileNotFoundError(
        "Cannot find 'aihydro-mcp' on PATH or 'mcp_server.py' in this directory.\n"
        "Install with: pip install aihydro-tools[all]"
    )


def _detect_ide() -> str:
    """Return the IDE key that has an existing MCP settings file."""
    for ide, path in _MCP_SETTINGS_PATHS.items():
        if path.exists():
            return ide
    # Fallback
    return "vscode"


def _load_settings(path: Path) -> dict:
    if not path.exists():
        if path.suffix == ".json" and "settings" in path.name:
            return {"mcpServers": {}}
        return {}
    with open(path) as f:
        return json.load(f)


def _save_settings(path: Path, data: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w") as f:
        json.dump(data, f, indent=2)
    print(f"  Saved: {path}")


def register(ide: str) -> None:
    path = _MCP_SETTINGS_PATHS[ide]
    settings = _load_settings(path)

    _cache_dir = Path.home() / ".aihydro" / "cache"
    _cache_dir.mkdir(parents=True, exist_ok=True)

    command, args = _get_server_command()
    server_entry = {
        "command": command,
        "args": args,
        "cwd": str(_cache_dir),
        "timeout": 600,  # 10 minutes — TWI + model training can take 3-10 min
        "env": {
            "TMPDIR": str(_cache_dir),
            "TEMP": str(_cache_dir),
            "TMP": str(_cache_dir),
        },
    }

    settings.setdefault("mcpServers", {})[_SERVER_KEY] = server_entry

    _save_settings(path, settings)
    print(f"\nAI-Hydro MCP server registered in {ide} ({path})")
    print(
        "\nTools now available:"
        "\n"
        "\n  Analysis (8):"
        "\n    delineate_watershed        — watershed boundary + gauge metadata"
        "\n    fetch_streamflow_data      — USGS daily discharge time series"
        "\n    extract_hydrological_signatures  — CAMELS-style flow signatures"
        "\n    extract_geomorphic_parameters    — 28 basin morphometry metrics"
        "\n    compute_twi                — Topographic Wetness Index statistics"
        "\n    create_cn_grid             — NRCS Curve Number grid"
        "\n    fetch_forcing_data         — basin-averaged GridMET forcing data"
        "\n    fetch_camels_us  — 60+ CAMELS attributes (via camels-attrs)"
        "\n"
        "\n  Session (6):"
        "\n    start_session              — create/resume research session"
        "\n    get_session_summary        — what's cached vs. pending"
        "\n    clear_session              — reset cached slots"
        "\n    add_note                   — attach researcher annotation"
        "\n    export_session             — full provenance export (json/bibtex/methods)"
        "\n    sync_research_context      — refresh .clinerules with session state"
        "\n"
        "\n  Modelling (2):"
        "\n    train_hydro_model          — differentiable HBV-light or LSTM"
        "\n    get_model_results          — cached model performance (NSE/KGE/RMSE)"
    )


def remove(ide: str) -> None:
    path = _MCP_SETTINGS_PATHS[ide]
    settings = _load_settings(path)
    servers = settings.get("mcpServers", {})
    if _SERVER_KEY in servers:
        del servers[_SERVER_KEY]
        _save_settings(path, settings)
        print(f"Removed '{_SERVER_KEY}' from {ide} MCP settings.")
    else:
        print(f"'{_SERVER_KEY}' not found in {ide} MCP settings — nothing to remove.")


def check() -> None:
    """Verify the server starts and registers the expected tools."""
    print("Checking AI-Hydro MCP server...")
    result = subprocess.run(
        [sys.executable, "-c",
         "import asyncio, sys; sys.path.insert(0, '.'); "
         "import mcp_server; "
         "tools = asyncio.run(mcp_server.mcp.list_tools()); "
         "print(','.join(t.name for t in tools))"],
        cwd=str(_HERE),
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        print(f"  ERROR:\n{result.stderr}")
        sys.exit(1)

    tool_names = result.stdout.strip().split(",")
    expected = {
        "delineate_watershed", "fetch_streamflow_data",
        "extract_hydrological_signatures", "extract_geomorphic_parameters",
        "compute_twi", "create_cn_grid", "fetch_forcing_data",
        "fetch_camels_us",
        "start_session", "get_session_summary", "clear_session",
        "add_note", "export_session", "sync_research_context",
        "train_hydro_model", "get_model_results",
    }
    got = set(tool_names)
    if got == expected:
        print(f"  OK — {len(got)} tools registered: {', '.join(sorted(got))}")
    else:
        missing = expected - got
        extra = got - expected
        if missing:
            print(f"  MISSING tools: {missing}")
        if extra:
            print(f"  UNEXPECTED tools: {extra}")
        sys.exit(1)


def main() -> None:
    parser = argparse.ArgumentParser(description="AI-Hydro MCP Server Setup")
    parser.add_argument(
        "--ide",
        choices=list(_MCP_SETTINGS_PATHS.keys()),
        default=None,
        help="Target IDE (auto-detected if not specified)",
    )
    parser.add_argument("--check", action="store_true", help="Verify server starts")
    parser.add_argument("--remove", action="store_true", help="Remove server entry")
    args = parser.parse_args()

    if args.check:
        check()
        return

    ide = args.ide or _detect_ide()

    if args.remove:
        remove(ide)
    else:
        register(ide)


if __name__ == "__main__":
    main()
