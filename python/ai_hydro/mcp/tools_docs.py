"""
Documentation and version utilities for the MCP server.

Generates .clinerules/tools.md from the live tool registry and
provides version introspection helpers.
"""
from __future__ import annotations

import logging
from pathlib import Path

log = logging.getLogger("ai_hydro.mcp")


def _get_version() -> str:
    """Return the installed ai-hydro package version."""
    try:
        from importlib.metadata import version
        return version("aihydro-tools")
    except Exception:
        return "unknown"


def _list_tools_sync() -> list:
    """Return the list of registered MCP tools (sync wrapper)."""
    import asyncio
    from ai_hydro.mcp.app import mcp
    try:
        loop = asyncio.get_event_loop()
        if loop.is_running():
            return []
        return asyncio.run(mcp.list_tools())
    except Exception:
        return []


def _write_tools_md() -> Path:
    """
    Write .aihydrorules/tools.md from the live MCP tool registry.

    This is the single source of truth for tool documentation.
    Community-added tools appear here automatically on next server start
    or sync_research_context call — no manual edits needed.
    """
    # Repo root: ai_hydro/mcp/tools_docs.py → up 4 levels
    repo_root = Path(__file__).resolve().parent.parent.parent.parent
    rules_dir = repo_root / ".aihydrorules"
    rules_dir.mkdir(parents=True, exist_ok=True)
    tools_md = rules_dir / "tools.md"

    tools = _list_tools_sync()
    if not tools:
        return tools_md

    lines = [
        "# AI-Hydro MCP Tools",
        "",
        "> Auto-generated from the live MCP server — do not edit manually.",
        "> Run `sync_research_context` or restart the server to refresh.",
        "",
        f"**{len(tools)} tools registered**",
        "",
        "---",
        "",
    ]

    for tool in sorted(tools, key=lambda t: t.name):
        # First paragraph of docstring = short description
        desc = (tool.description or "").strip()
        short_desc = desc.split("\n\n")[0].replace("\n", " ").strip()

        lines.append(f"### `{tool.name}`")
        if short_desc:
            lines.append(short_desc)

        # Parameters from JSON schema
        schema = getattr(tool, "inputSchema", {}) or {}
        props = schema.get("properties", {})
        required = set(schema.get("required", []))
        if props:
            lines.append("")
            lines.append("**Parameters**")
            for param, info in props.items():
                ptype = info.get("type", "any")
                pdesc = info.get("description", "")
                req_marker = "" if param in required else " *(optional)*"
                param_line = f"- `{param}` ({ptype}){req_marker}"
                if pdesc:
                    param_line += f" — {pdesc}"
                lines.append(param_line)

        lines.append("")

    tools_md.write_text("\n".join(lines))
    log.info("tools.md written: %d tools -> %s", len(tools), tools_md)
    return tools_md
