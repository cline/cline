"""
Map orchestration MCP tools — read/write host map session via file bridge.

Agents use these tools to inspect map state, set ROI, open the map panel,
and persist ROI to the workspace without holding a gRPC connection.
"""
from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from ai_hydro.mcp.app import mcp
from ai_hydro.mcp.helpers import (
    _ensure_session,
    _normalize_session_id,
    _resolve_active_roi_geojson,
    _tool_error_to_dict,
    _workspace_write,
)
from ai_hydro.mcp.map_commands import push_fit_extent, push_set_roi, push_show_map

log = logging.getLogger("ai_hydro.mcp")

_MAP_SESSION_FILE = Path.home() / ".aihydro" / "map_session.json"
_MAP_EVENTS_OUTBOUND = Path.home() / ".aihydro" / "map_events" / "outbound"


def _read_map_session_file() -> dict[str, Any]:
    try:
        return json.loads(_MAP_SESSION_FILE.read_text(encoding="utf-8"))
    except Exception:
        return {}


def _recent_outbound_events(limit: int = 10) -> list[dict[str, Any]]:
    if not _MAP_EVENTS_OUTBOUND.is_dir():
        return []
    files = sorted(_MAP_EVENTS_OUTBOUND.glob("*.json"), key=lambda p: p.stat().st_mtime)[-limit:]
    events: list[dict[str, Any]] = []
    for fp in files:
        try:
            events.append(json.loads(fp.read_text(encoding="utf-8")))
        except Exception:
            continue
    return events


@mcp.tool()
def map_get_state(session_id: str | None = None, event_limit: int = 10) -> dict:
    """
    Return the current map session snapshot: basemap, view, visible layers,
    workspace root, and recent map events.

    Reads ~/.aihydro/map_session.json written by the VS Code host. Use after
    the user interacts with the map or after map.set_roi / delineate_watershed.
    """
    try:
        session_id = _normalize_session_id(session_id) if session_id else None
        persisted = _read_map_session_file()
        active_roi = persisted.get("activeRoi") or persisted.get("active_roi")
        roi_summary = None
        if active_roi:
            roi_summary = {
                "id": active_roi.get("id"),
                "name": active_roi.get("name"),
                "source": active_roi.get("source"),
                "workspace_path": active_roi.get("workspacePath") or active_roi.get("workspace_path"),
                "area_ha": active_roi.get("areaHa") or active_roi.get("area_ha"),
                "has_geometry": bool(active_roi.get("geojson")),
            }
        resolved = None
        if session_id:
            try:
                geojson, source = _resolve_active_roi_geojson(session_id)
                resolved = {"source": source, "geometry_type": geojson.get("type")}
            except Exception as exc:
                resolved = {"error": str(exc)}

        basemap_id = persisted.get("basemapId") or persisted.get("basemap_id")
        basemap_name = persisted.get("basemapName") or persisted.get("basemap_name")

        return {
            "active_roi": roi_summary,
            "basemap": (
                {"id": basemap_id, "name": basemap_name or basemap_id}
                if basemap_id
                else None
            ),
            "view": persisted.get("view"),
            "visible_layer_ids": persisted.get("visibleLayerIds")
            or persisted.get("visible_layer_ids"),
            "workspace_root": persisted.get("workspaceRoot") or persisted.get("workspace_root"),
            "updated_at_ms": persisted.get("updatedAtMs") or persisted.get("updated_at_ms"),
            "resolved_roi_for_session": resolved,
            "recent_events": _recent_outbound_events(max(1, min(event_limit, 50))),
        }
    except Exception as e:
        return _tool_error_to_dict(e)


@mcp.tool()
def map_set_roi(
    session_id: str,
    geojson: str | dict,
    name: str = "Agent ROI",
    area_ha: float = 0,
) -> dict:
    """
    Set the active map ROI (study basin polygon). The map panel updates via
    the host command watcher. Pass GeoJSON Feature, FeatureCollection, or JSON string.
    """
    try:
        session_id = _normalize_session_id(session_id)
        _ensure_session(session_id, None)
        ok = push_set_roi(
            geojson=geojson,
            name=name,
            source="agent",
            area_ha=area_ha,
        )
        return {"ok": ok, "message": "ROI command queued for map host" if ok else "Failed to queue ROI"}
    except Exception as e:
        return _tool_error_to_dict(e)


@mcp.tool()
def map_show() -> dict:
    """Open the AI-Hydro map panel if it is not already visible."""
    ok = push_show_map(open_map=True)
    return {"ok": ok, "message": "Map open requested" if ok else "Failed to open map"}


@mcp.tool()
def map_set_working_geometry(session_id: str, workspace_path: str) -> dict:
    """
    Set which workspace GeoJSON file is the active study geometry for this session
    (used by current_map_basin / GEE). Path is relative to workspace, e.g.
    vectors/my_basin.geojson or watershed_01031500.geojson.
    """
    try:
        session_id = _normalize_session_id(session_id)
        session = _ensure_session(session_id, None)
        rel = workspace_path.strip().lstrip("/")
        if not rel:
            return {"ok": False, "message": "workspace_path is required"}
        if session.workspace_dir:
            full = Path(session.workspace_dir) / rel
            if not full.exists():
                return {"ok": False, "message": f"File not found: {rel}"}
        session.working_geometry_path = rel
        session.save()
        return {"ok": True, "working_geometry_path": rel}
    except Exception as e:
        return _tool_error_to_dict(e)


@mcp.tool()
def map_fit_extent() -> dict:
    """Ask the map to fit the viewport to the active ROI or visible layers."""
    ok = push_fit_extent()
    return {"ok": ok, "message": "Fit extent requested" if ok else "Failed to queue fit"}


@mcp.tool()
def map_save_roi(
    session_id: str,
    name: str,
    workspace_dir: str | None = None,
) -> dict:
    """
    Save the host map session active ROI to workspace roi/<slug>.geojson
    and update roi/active.json. Requires an active ROI on the map session file.
    """
    try:
        session_id = _normalize_session_id(session_id)
        session = _ensure_session(session_id, workspace_dir)
        persisted = _read_map_session_file()
        active_roi = persisted.get("activeRoi") or persisted.get("active_roi")
        if not active_roi or not active_roi.get("geojson"):
            return {
                "ok": False,
                "message": "No active ROI in map session. Use map_set_roi or draw on the map first.",
            }
        geojson_raw = active_roi.get("geojson")
        if isinstance(geojson_raw, str):
            geojson = json.loads(geojson_raw)
        else:
            geojson = geojson_raw

        slug = (
            name.lower()
            .replace(" ", "_")
            .replace("-", "_")
        )
        for ch in slug:
            if not (ch.isalnum() or ch == "_"):
                slug = slug.replace(ch, "_")
        slug = slug.strip("_")[:64] or "basin"
        rel_geo = f"roi/{slug}.geojson"
        saved = _workspace_write(session_id, rel_geo, geojson)
        if not saved:
            return {"ok": False, "message": "Workspace write failed — set workspace_dir on session first"}

        pointer = {
            "path": rel_geo,
            "name": active_roi.get("name") or name,
            "updatedAt": datetime.now(timezone.utc).isoformat(),
        }
        _workspace_write(session_id, "roi/active.json", pointer)
        push_set_roi(
            geojson=geojson_raw if isinstance(geojson_raw, str) else json.dumps(geojson),
            name=pointer["name"],
            source="workspace",
            workspace_path=rel_geo,
        )
        return {
            "ok": True,
            "workspace_path": rel_geo,
            "active_pointer": "roi/active.json",
            "saved_to": saved,
        }
    except Exception as e:
        return _tool_error_to_dict(e)
