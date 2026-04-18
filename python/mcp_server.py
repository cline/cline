"""
AI-Hydro MCP Server — entry point.

Thin wrapper that sets up paths and the Box Drive workaround,
then delegates to the modular tool registry in ``ai_hydro.mcp``.

Usage
-----
    python mcp_server.py

Or via pip install:
    pip install aihydro-tools[all]
    aihydro-mcp
"""
from __future__ import annotations

import logging
import os
import sys
from pathlib import Path

# ── Dev mode: ensure the package is importable when run directly from monorepo ──
_SERVER_DIR = Path(__file__).parent
if str(_SERVER_DIR) not in sys.path:
    sys.path.insert(0, str(_SERVER_DIR))

# ── Redirect cache/temp writes away from Box Drive (avoids read-only errors) ──
_CACHE_DIR = Path.home() / ".aihydro" / "cache"
_CACHE_DIR.mkdir(parents=True, exist_ok=True)
os.chdir(_CACHE_DIR)
os.environ.setdefault("TMPDIR", str(_CACHE_DIR))
os.environ.setdefault("TEMP", str(_CACHE_DIR))
os.environ.setdefault("TMP", str(_CACHE_DIR))

# ── Logging ──
logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
log = logging.getLogger("ai_hydro.mcp")

# ── Import triggers tool registration via __init__.py ──
from ai_hydro.mcp import mcp  # noqa: E402
from ai_hydro.mcp.tools_docs import _write_tools_md  # noqa: E402


def main():
    """Entry point for the ``aihydro-mcp`` console script (pyproject.toml)."""
    log.info("Starting AI-Hydro MCP server...")
    # Auto-generate .aihydrorules/tools.md on every startup
    try:
        _write_tools_md()
    except Exception as _e:
        log.debug("tools.md generation skipped: %s", _e)
    mcp.run()


if __name__ == "__main__":
    main()
