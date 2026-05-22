"""
MIRROR ONLY — canonical implementation: aihydro-tools (pip install -e …/aihydro-tools).
The VS Code extension uses the installed aihydro-mcp package, not this file.
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
from ai_hydro.mcp.map_commands import (
    push_fit_extent,
    push_fit_layer,
    push_remove_layer,
    push_set_basemap,
    push_set_roi,
    push_set_layer_visibility,
    push_show_map,
    push_update_layer,
)
from ai_hydro.mcp.map_events import STYLES
from ai_hydro.mcp.map_layer_catalog import (
    compute_graduated_metadata,
    find_catalog_layer,
    list_layer_ids,
    load_geojson_for_layer,
    read_layer_catalog,
)

log = logging.getLogger("ai_hydro.mcp")

_MAP_SESSION_FILE = Path.home() / ".aihydro" / "map_session.json"
_MAP_LAYER_CATALOG_FILE = Path.home() / ".aihydro" / "map_layer_catalog.json"
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

        catalog = read_layer_catalog()

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
            "layer_order": catalog.get("layer_order") or [],
            "layers": catalog.get("layers") or [],
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
def map_list_layers() -> dict:
    """List map layer ids and catalog entries from the host (~/.aihydro/map_layer_catalog.json)."""
    try:
        catalog = read_layer_catalog()
        return {
            "ok": True,
            "layer_order": catalog.get("layer_order") or [],
            "layers": catalog.get("layers") or [],
            "layer_ids": list_layer_ids(),
        }
    except Exception as e:
        return _tool_error_to_dict(e)


def _layer_not_found(layer_id: str) -> dict:
    ids = list_layer_ids()
    return {
        "ok": False,
        "message": f"Unknown layer_id '{layer_id}'. Known layers: {ids or '(none — open map and load layers first)'}",
        "layer_ids": ids,
    }


@mcp.tool()
def map_update_layer(
    layer_id: str,
    style_preset: str | None = None,
    fill_color: str | None = None,
    stroke_color: str | None = None,
    fill_opacity: float | None = None,
    stroke_width: int | None = None,
    visible: bool | None = None,
    display_name: str | None = None,
    raster_colormap: str | None = None,
    raster_opacity: float | None = None,
    clear_graduated: bool = False,
    graduated_attribute: str | None = None,
    graduated_method: str = "quantile",
    graduated_classes: int = 5,
    color_ramp: str = "viridis",
) -> dict:
    """
    Update symbology or visibility of an existing map layer by id (in-place).
    Do not write a new GeoJSON file to change styling.

    For choropleth styling, set graduated_attribute (and optional method/classes/ramp).
    """
    try:
        entry = find_catalog_layer(layer_id)
        if not entry:
            return _layer_not_found(layer_id)

        style: dict[str, Any] = {}
        metadata: dict[str, str] = {}

        if style_preset:
            preset = STYLES.get(style_preset, STYLES["default"])
            style = {k: v for k, v in preset.items() if isinstance(v, (str, int, float))}
        if fill_color:
            style["fillColor"] = fill_color
        if stroke_color:
            style["strokeColor"] = stroke_color
            style["color"] = stroke_color
        if fill_opacity is not None:
            style["fillOpacity"] = fill_opacity
        if stroke_width is not None:
            style["strokeWidth"] = stroke_width
            style["weight"] = stroke_width

        if raster_colormap:
            metadata["raster_colormap"] = raster_colormap
        if raster_opacity is not None:
            metadata["raster_opacity"] = str(raster_opacity)

        if graduated_attribute:
            persisted = _read_map_session_file()
            workspace_root = persisted.get("workspaceRoot") or persisted.get("workspace_root")
            geojson = load_geojson_for_layer(entry, workspace_root)
            metadata.update(
                compute_graduated_metadata(
                    geojson,
                    attribute=graduated_attribute,
                    method=graduated_method,
                    num_classes=graduated_classes,
                    color_ramp=color_ramp,
                )
            )
            clear_graduated = False

        ok = push_update_layer(
            layer_id=layer_id,
            style=style or None,
            metadata=metadata or None,
            visible=visible,
            display_name=display_name,
            clear_graduated=clear_graduated,
        )
        if visible is not None:
            push_set_layer_visibility(layer_id, visible)
        return {
            "ok": ok,
            "layer_id": layer_id,
            "message": "Layer update queued for map host" if ok else "Failed to queue update",
        }
    except Exception as e:
        return _tool_error_to_dict(e)


@mcp.tool()
def map_apply_symbology(
    layer_id: str,
    attribute: str,
    method: str = "quantile",
    num_classes: int = 5,
    color_ramp: str = "viridis",
) -> dict:
    """Apply graduated (choropleth) symbology to an existing vector layer on the map."""
    return map_update_layer(
        layer_id=layer_id,
        graduated_attribute=attribute,
        graduated_method=method,
        graduated_classes=num_classes,
        color_ramp=color_ramp,
    )


@mcp.tool()
def map_remove_layer(layer_id: str) -> dict:
    """Remove a layer from the map by id."""
    if not find_catalog_layer(layer_id):
        return _layer_not_found(layer_id)
    ok = push_remove_layer(layer_id)
    return {"ok": ok, "layer_id": layer_id}


@mcp.tool()
def map_set_basemap(basemap_id: str, basemap_name: str | None = None) -> dict:
    """Set the map basemap (e.g. esri-imagery, usgs-topo)."""
    ok = push_set_basemap(basemap_id, basemap_name)
    return {"ok": ok, "basemap_id": basemap_id}


@mcp.tool()
def map_fit_layer(layer_id: str) -> dict:
    """Zoom the map viewport to a layer's extent."""
    if not find_catalog_layer(layer_id):
        return _layer_not_found(layer_id)
    ok = push_fit_layer(layer_id)
    return {"ok": ok, "layer_id": layer_id}


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
