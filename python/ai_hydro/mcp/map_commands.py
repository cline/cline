"""
Map command writer — pushes orchestration commands to ~/.aihydro/map_commands/.

The VS Code extension MapCommandWatcher polls this directory and applies
set_roi, show_map, and fit_extent commands to MapSessionService.
"""
from __future__ import annotations

import json
import logging
import uuid
from pathlib import Path
from typing import Any

log = logging.getLogger(__name__)

_MAP_COMMANDS_DIR = Path.home() / ".aihydro" / "map_commands"


def write_map_command(payload: dict[str, Any]) -> bool:
    """Write a one-shot command JSON file. Never raises."""
    try:
        _MAP_COMMANDS_DIR.mkdir(parents=True, exist_ok=True)
        event_file = _MAP_COMMANDS_DIR / f"{uuid.uuid4().hex}.json"
        event_file.write_text(json.dumps(payload), encoding="utf-8")
        log.debug("Map command written: %s", payload.get("type"))
        return True
    except Exception as exc:
        log.warning("write_map_command failed (non-fatal): %s", exc)
        return False


def push_set_roi(
    *,
    geojson: str | dict,
    name: str = "Agent ROI",
    source: str = "agent",
    area_ha: float = 0,
    roi_id: str | None = None,
    workspace_path: str = "",
) -> bool:
    geojson_str = geojson if isinstance(geojson, str) else json.dumps(geojson)
    return write_map_command(
        {
            "type": "set_roi",
            "roi": {
                "id": roi_id or f"roi_{uuid.uuid4().hex[:8]}",
                "name": name,
                "source": source,
                "geojson": geojson_str,
                "area_ha": area_ha,
                "workspace_path": workspace_path,
            },
        }
    )


def push_show_map(open_map: bool = True) -> bool:
    return write_map_command({"type": "show_map", "open_map": open_map})


def push_fit_extent() -> bool:
    return write_map_command({"type": "fit_extent"})
