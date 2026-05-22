"""
Shared helper functions for MCP tool implementations.
"""
from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any

log = logging.getLogger("ai_hydro.mcp")


# ---------------------------------------------------------------------------
# Session identity helpers
# ---------------------------------------------------------------------------

def _normalize_session_id(session_id: str | None) -> str:
    """
    Accept any string as a session identifier.

    - Non-empty string → returned as-is (slugs, UUIDs, gauge IDs all valid)
    - None / empty → auto-generate "hydro-<8hex>" UUID
    """
    if session_id and str(session_id).strip():
        return str(session_id).strip()
    import uuid
    return f"hydro-{uuid.uuid4().hex[:8]}"


def _validate_usgs_gauge_id(gauge_id: str) -> str:
    """
    Validate and normalise a USGS station number.

    Used ONLY in tools that fetch data from USGS NWIS / NLDI.
    Auto-pads short IDs (e.g. '1031500' → '01031500').
    Raises ValueError for non-numeric inputs.
    """
    gid = str(gauge_id).strip()
    if gid.isdigit() and len(gid) < 8:
        gid = gid.zfill(8)
    if not gid.isdigit():
        raise ValueError(
            f"Invalid USGS gauge_id: {gauge_id!r}. "
            "Expected an 8-digit USGS station number (e.g. '01031500'). "
            "Find gauge IDs at https://waterdata.usgs.gov/"
        )
    return gid


# Backward-compat alias — callers that haven't been updated yet
def _validate_gauge_id(gauge_id: str) -> str:
    return _validate_usgs_gauge_id(gauge_id)


# ---------------------------------------------------------------------------
# Result conversion
# ---------------------------------------------------------------------------

def _result_to_dict(result: Any) -> dict:
    if hasattr(result, "to_dict"):
        return result.to_dict()
    if isinstance(result, dict):
        return result
    return {"data": str(result)}


# ---------------------------------------------------------------------------
# Session management
# ---------------------------------------------------------------------------

def _session_store(
    session_id: str, slot: str, result_dict: dict, *, tool_name: str | None = None
) -> None:
    """Cache a tool result in HydroSession and refresh research.md.

    If ``tool_name`` is provided, Tier 1 data-source citations for that tool
    are added to the session in the same save() call (zero extra file writes).
    """
    try:
        from ai_hydro.session import HydroSession
        session = HydroSession.load(session_id)
        setattr(session, slot, result_dict)
        if tool_name:
            from ai_hydro.citations import citation_keys_for_tool
            keys = citation_keys_for_tool(tool_name)
            if keys:
                session.add_citations(keys)
        session.save()
    except Exception as exc:
        log.debug("Session store skipped (%s): %s", slot, exc)


def _resolve_active_roi_geojson(session_id: str) -> tuple[dict, str]:
    """
    Resolve study-basin geometry for current_map_basin / GEE tools.

    Priority:
    1. session.working_geometry_path (agent/user selected workspace file)
    2. Workspace roi/active.json → GeoJSON file (legacy)
    3. Host map session ~/.aihydro/map_session.json active_roi (legacy)
    4. HydroSession watershed (agent delineation)
    """
    try:
        from ai_hydro.session import HydroSession
        session = HydroSession.load(session_id)
        working = getattr(session, "working_geometry_path", None)
        if working and session.workspace_dir:
            geo_path = Path(session.workspace_dir) / working
            if geo_path.exists():
                with open(geo_path, encoding="utf-8") as gf:
                    return json.load(gf), "working_geometry"
        ws_dir = session.workspace_dir
        if ws_dir:
            pointer_path = Path(ws_dir) / "roi" / "active.json"
            if pointer_path.exists():
                with open(pointer_path, encoding="utf-8") as f:
                    pointer = json.load(f)
                rel = pointer.get("path")
                if rel:
                    geo_path = Path(ws_dir) / rel
                    if geo_path.exists():
                        with open(geo_path, encoding="utf-8") as gf:
                            return json.load(gf), "workspace_roi"
    except Exception as exc:
        log.debug("Workspace ROI resolution skipped: %s", exc)

    map_session_path = Path.home() / ".aihydro" / "map_session.json"
    try:
        if map_session_path.exists():
            data = json.loads(map_session_path.read_text(encoding="utf-8"))
            active = data.get("activeRoi") or data.get("active_roi")
            if active:
                raw = active.get("geojson")
                if raw:
                    if isinstance(raw, str):
                        parsed = json.loads(raw)
                    else:
                        parsed = raw
                    if isinstance(parsed, dict):
                        return parsed, "map_session"
    except Exception as exc:
        log.debug("Map session ROI resolution skipped: %s", exc)

    return _get_session_geometry(session_id), "session_watershed"


def _get_session_geometry(session_id: str) -> dict:
    """
    Return the watershed GeoJSON dict from the cached session.

    Supports both storage forms:
    - New (v1.3+): session stores geometry_geojson_path → reads from file
    - Legacy: session stores full geometry_geojson dict inline
    """
    try:
        from ai_hydro.session import HydroSession
        session = HydroSession.load(session_id)
        if session.watershed is None:
            raise RuntimeError(
                f"No watershed cached for session '{session_id}'. "
                "Run delineate_watershed first."
            )
        ws_data = session.watershed.get("data", {})

        geojson_path = ws_data.get("geometry_geojson_path")
        if geojson_path:
            p = Path(geojson_path)
            if p.exists():
                with open(p) as f:
                    return json.load(f)
            log.warning(
                "geometry_geojson_path points to missing file %s for session %s; "
                "trying legacy inline storage", geojson_path, session_id
            )

        geojson = (
            ws_data.get("geometry_geojson")
            or ws_data.get("geometry")
            or ws_data.get("geojson")
        )
        if geojson is not None:
            return geojson

        raise RuntimeError(
            f"Watershed geometry missing from session '{session_id}'. "
            "The session may be corrupted. Run: "
            f"clear_session('{session_id}', ['watershed']) then delineate_watershed again."
        )
    except RuntimeError:
        raise
    except Exception as exc:
        raise RuntimeError(f"Could not load session geometry: {exc}") from exc


def _workspace_write(session_id: str, filename: str, content: Any) -> str | None:
    """Write content to the workspace directory stored in HydroSession."""
    try:
        from ai_hydro.session import HydroSession
        session = HydroSession.load(session_id)
        return session.write_workspace_file(filename, content)
    except Exception as exc:
        log.debug("Workspace write skipped (%s): %s", filename, exc)
        return None


def _ensure_session(session_id: str, workspace_dir: str | None = None):
    """Load (or create) a HydroSession. Store workspace_dir if new."""
    from ai_hydro.session import HydroSession
    session = HydroSession.load(session_id)
    if workspace_dir and session.workspace_dir != workspace_dir:
        session.workspace_dir = workspace_dir
        session.save()
    return session


# ---------------------------------------------------------------------------
# Response helpers
# ---------------------------------------------------------------------------

def _sync_reminder(session_id: str) -> str | None:
    """
    Return a mandatory reminder to call sync_research_context when ≥2 slots
    are computed and no interpretation has been written yet.

    Injected into every analysis tool response so the LLM cannot miss it.
    Returns None when not yet relevant (< 2 computed, or already interpreted).
    """
    try:
        from ai_hydro.session import HydroSession
        session = HydroSession.load(session_id)
        n = len(session.computed())
        if n >= 2 and not session.interpretation:
            return (
                f"[{n} analyses complete, no interpretation yet] "
                f"When ALL planned steps are done, your FINAL action MUST be "
                f"sync_research_context('{session_id}'). "
                "Skip this and the science disappears between conversations."
            )
    except Exception:
        pass
    return None


def _tool_error_to_dict(e: Exception) -> dict:
    if hasattr(e, "to_dict"):
        return e.to_dict()
    return {"error": True, "code": "UNKNOWN_ERROR", "message": str(e)}


def _cached_response(slot: str, session, *, extra: dict | None = None) -> dict:
    result = getattr(session, slot)
    r: dict = {
        "data": result.get("data", {}),
        "meta": result.get("meta", {}),
        "_cached": True,
        "_note": (
            f"Result loaded from session cache. "
            f"Call clear_session('{session.session_id}', ['{slot}']) to recompute."
        ),
        **(extra or {}),
    }
    reminder = _sync_reminder(session.session_id)
    if reminder:
        r["_sync_required"] = reminder
    return r


def _strip_forcing_arrays(data: dict) -> dict:
    """Remove large daily arrays from forcing data, keeping per-variable means."""
    compact: dict = {}
    var_means: dict = {}
    for k, v in data.items():
        if isinstance(v, list):
            valid = [x for x in v if x is not None and isinstance(x, (int, float))]
            if valid:
                var_means[f"{k}_mean"] = round(sum(valid) / len(valid), 4)
        else:
            compact[k] = v
    compact.update(var_means)
    if var_means:
        compact["n_variables"] = len(var_means)
    return compact
