"""
AI-Hydro knowledge base — library references and field-name gotchas.

Built-in references live in library_refs/*.json.
Community plugins can extend this via the aihydro.knowledge entry point.
"""
from __future__ import annotations

import json
from pathlib import Path

_REFS_DIR = Path(__file__).parent / "library_refs"


def _all_ref_dirs() -> list[Path]:
    """Return all reference directories: built-in + plugin-contributed."""
    dirs = [_REFS_DIR]
    try:
        from ai_hydro.mcp.registry import discover_knowledge
        dirs.extend(discover_knowledge())
    except Exception:
        pass
    return dirs


def get_library_ref(library: str) -> dict | None:
    """Load a library reference — checks built-in first, then plugin dirs."""
    name = library.lower()
    for ref_dir in _all_ref_dirs():
        path = ref_dir / f"{name}.json"
        if path.exists():
            return json.loads(path.read_text())
    return None


def list_library_refs() -> list[str]:
    """Return names of all available library references across all sources."""
    names: set[str] = set()
    for ref_dir in _all_ref_dirs():
        names.update(p.stem for p in ref_dir.glob("*.json"))
    return sorted(names)
