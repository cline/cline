"""
Shared helper functions for MCP tool implementations.

These are used by tools_analysis, tools_session, and tools_modelling
to convert results, manage sessions, and validate inputs.
"""
from __future__ import annotations

import logging
from typing import Any

log = logging.getLogger("ai_hydro.mcp")


def _result_to_dict(result: Any) -> dict:
    """Convert HydroResult to a plain JSON-serializable dict."""
    if hasattr(result, "to_dict"):
        return result.to_dict()
    if isinstance(result, dict):
        return result
    return {"data": str(result)}


def _session_store(gauge_id: str, slot: str, result_dict: dict) -> None:
    """Cache a tool result in HydroSession and refresh research.md. Fire-and-forget."""
    try:
        from ai_hydro.session import HydroSession
        session = HydroSession.load(gauge_id)
        setattr(session, slot, result_dict)
        session.save()  # also writes .clinerules/research.md
    except Exception as exc:
        log.debug("Session store skipped (%s): %s", slot, exc)


def _get_session_geometry(gauge_id: str) -> dict:
    """
    Return the watershed GeoJSON dict from the cached session.

    Supports both storage forms:
    - New (v1.3+): session stores ``geometry_geojson_path`` → reads from file
    - Legacy: session stores full ``geometry_geojson`` dict inline

    Raises RuntimeError if watershed has not been delineated yet or if the
    geometry cannot be loaded from any known location.
    """
    import json
    from pathlib import Path
    try:
        from ai_hydro.session import HydroSession
        session = HydroSession.load(gauge_id)
        if session.watershed is None:
            raise RuntimeError(
                f"No watershed cached for gauge {gauge_id}. "
                "Run delineate_watershed first."
            )
        ws_data = session.watershed.get("data", {})

        # Preferred: path reference — load geometry from file (lean session JSON)
        geojson_path = ws_data.get("geometry_geojson_path")
        if geojson_path:
            p = Path(geojson_path)
            if p.exists():
                with open(p) as f:
                    return json.load(f)
            # Path stored but file missing — fall through to legacy keys
            log.warning(
                "geometry_geojson_path points to missing file %s; "
                "trying legacy inline storage for gauge %s", geojson_path, gauge_id
            )

        # Legacy fallback: geometry stored inline in session JSON
        geojson = (
            ws_data.get("geometry_geojson")
            or ws_data.get("geometry")
            or ws_data.get("geojson")
        )
        if geojson is not None:
            return geojson

        raise RuntimeError(
            f"Watershed geometry missing from session for gauge {gauge_id}. "
            "The session may be corrupted. Run: "
            f"clear_session('{gauge_id}', ['watershed']) then delineate_watershed again."
        )
    except RuntimeError:
        raise
    except Exception as exc:
        raise RuntimeError(f"Could not load session geometry: {exc}") from exc


def _workspace_write(gauge_id: str, filename: str, content: Any) -> str | None:
    """
    Write content to the workspace directory stored in HydroSession.

    Returns the path written, or None if workspace_dir is not set.
    This lets the MCP server save files directly — no agent write_file needed.
    """
    try:
        from ai_hydro.session import HydroSession
        session = HydroSession.load(gauge_id)
        return session.write_workspace_file(filename, content)
    except Exception as exc:
        log.debug("Workspace write skipped (%s): %s", filename, exc)
        return None


def _ensure_session(gauge_id: str, workspace_dir: str | None = None):
    """
    Load (or create) a HydroSession for gauge_id.

    If workspace_dir is provided and the session doesn't have one yet,
    store it so all subsequent writes go to the right place.
    Returns the session object.
    """
    from ai_hydro.session import HydroSession
    session = HydroSession.load(gauge_id)
    if workspace_dir and session.workspace_dir != workspace_dir:
        session.workspace_dir = workspace_dir
        session.save()
    return session


def _tool_error_to_dict(e: Exception) -> dict:
    """Convert ToolError to a structured error response."""
    if hasattr(e, "to_dict"):
        return e.to_dict()
    return {"error": True, "code": "UNKNOWN_ERROR", "message": str(e)}


def _validate_gauge_id(gauge_id: str) -> str:
    """Normalize and validate a USGS gauge ID.

    Auto-pads short IDs (e.g. '1031500' -> '01031500').
    Raises ValueError with a helpful message for invalid inputs.
    """
    gid = str(gauge_id).strip()
    if gid.isdigit() and len(gid) < 8:
        gid = gid.zfill(8)
    if not gid.isdigit():
        raise ValueError(
            f"Invalid gauge_id: {gauge_id!r}. Expected an 8-digit USGS station number "
            "(e.g. '01031500'). Find gauge IDs at https://waterdata.usgs.gov/"
        )
    return gid


def _cached_response(slot: str, session, *, extra: dict | None = None) -> dict:
    """Return a compact cache-hit response for a session slot."""
    result = getattr(session, slot)
    return {
        "data": result.get("data", {}),
        "meta": result.get("meta", {}),
        "_cached": True,
        "_note": (
            f"Result loaded from session cache. "
            f"Call clear_session('{session.gauge_id}', ['{slot}']) to recompute."
        ),
        **(extra or {}),
    }


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
