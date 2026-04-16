"""
MCP Tool Entry Point Discovery
================================

Auto-discover tools and knowledge extensions registered via Python entry points.

Community plugins register tools in their own ``pyproject.toml``::

    [project.entry-points."aihydro.tools"]
    my_tool = "my_package.module:my_tool_function"

Knowledge plugins can extend library references::

    [project.entry-points."aihydro.knowledge"]
    my_lib = "my_package.knowledge:get_refs_dir"

Then ``discover_tools()`` and ``discover_knowledge()`` find them at runtime so
the MCP server can register them without any code change in ai-hydro core.
"""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Any, Callable

log = logging.getLogger("ai_hydro.mcp")


def discover_tools() -> list[tuple[str, Callable[..., Any]]]:
    """
    Auto-discover tools registered via the ``aihydro.tools`` entry point group.

    Returns
    -------
    list of (name, callable) tuples
        Each entry is a (tool_name, tool_function) pair that the MCP server
        can register as an additional tool.
    """
    try:
        from importlib.metadata import entry_points
    except ImportError:
        from importlib_metadata import entry_points  # type: ignore[no-redef]

    discovered: list[tuple[str, Callable[..., Any]]] = []
    eps = entry_points(group="aihydro.tools")
    for ep in eps:
        try:
            tool_fn = ep.load()
            discovered.append((ep.name, tool_fn))
            log.info("Discovered plugin tool: %s (%s)", ep.name, ep.value)
        except Exception as exc:
            log.warning("Failed to load plugin tool %s: %s", ep.name, exc)

    return discovered


def discover_knowledge() -> list[Path]:
    """
    Auto-discover knowledge reference directories via the ``aihydro.knowledge``
    entry point group.

    Plugins export a callable that returns a ``pathlib.Path`` to a directory
    of ``*.json`` library reference files::

        # my_package/knowledge.py
        from pathlib import Path
        def get_refs_dir() -> Path:
            return Path(__file__).parent / "library_refs"

        # pyproject.toml
        [project.entry-points."aihydro.knowledge"]
        my_lib = "my_package.knowledge:get_refs_dir"

    Returns
    -------
    list of Path objects pointing to knowledge reference directories.
    """
    try:
        from importlib.metadata import entry_points
    except ImportError:
        from importlib_metadata import entry_points  # type: ignore[no-redef]

    dirs: list[Path] = []
    eps = entry_points(group="aihydro.knowledge")
    for ep in eps:
        try:
            get_dir = ep.load()
            ref_dir = get_dir()
            if isinstance(ref_dir, Path) and ref_dir.is_dir():
                dirs.append(ref_dir)
                log.info("Discovered knowledge plugin: %s → %s", ep.name, ref_dir)
            else:
                log.warning("Knowledge plugin %s did not return a valid Path", ep.name)
        except Exception as exc:
            log.warning("Failed to load knowledge plugin %s: %s", ep.name, exc)

    return dirs
