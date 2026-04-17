"""
Session management MCP tools (8 tools).

Start, query, clear, annotate, sync, export, and discover research sessions and tools.
"""
from __future__ import annotations

import json
import logging
import subprocess
import sys
from pathlib import Path

from ai_hydro.mcp.app import mcp
from ai_hydro.mcp.helpers import (
    _tool_error_to_dict,
    _validate_gauge_id,
    _workspace_write,
)

log = logging.getLogger("ai_hydro.mcp")


@mcp.tool()
def start_session(gauge_id: str, workspace_dir: str | None = None) -> dict:
    """
    Start or resume a research session for a USGS gauge.

    Creates a new session if one does not exist, or returns the existing
    session summary if already started. Pass workspace_dir so that all
    subsequent tool calls automatically save output files to the VS Code
    workspace — no agent write_file calls needed.

    Parameters
    ----------
    gauge_id : str
        8-digit USGS gauge ID, e.g. '01031500'
    workspace_dir : str, optional
        Absolute path to the VS Code workspace folder. When provided,
        all MCP tools will save their output files there automatically.

    Returns
    -------
    dict with keys:
        gauge_id      : the gauge
        workspace_dir : path where files will be saved (if set)
        computed      : list of already-computed result slots
        pending       : list of not-yet-computed result slots
        notes         : researcher annotations attached to this session
        created_at, updated_at : ISO timestamps
    """
    try:
        from ai_hydro.session import HydroSession
        session = HydroSession.load(gauge_id)
        if workspace_dir:
            session.workspace_dir = workspace_dir
        session.save()
        summary = session.summary()
        summary["workspace_dir"] = session.workspace_dir

        # Expose the MCP server's Python environment so agents can write
        # scripts that use the same interpreter and installed packages.
        summary["mcp_python"] = sys.executable
        pip_path = Path(sys.executable).parent / "pip"
        summary["mcp_pip"] = str(pip_path) if pip_path.exists() else f"{sys.executable} -m pip"
        try:
            result = subprocess.run(
                [sys.executable, "-m", "pip", "list", "--format=json"],
                capture_output=True, text=True, timeout=10
            )
            pkgs = json.loads(result.stdout) if result.returncode == 0 else []
            summary["available_packages"] = {p["name"]: p["version"] for p in pkgs}
        except Exception:
            summary["available_packages"] = {}

        return summary
    except Exception as e:
        log.error("start_session failed: %s", e)
        return _tool_error_to_dict(e)


@mcp.tool()
def get_session_summary(gauge_id: str) -> dict:
    """
    Return what has been computed and what still needs computing.

    Parameters
    ----------
    gauge_id : str
        8-digit USGS gauge ID

    Returns
    -------
    dict with computed/pending slot lists and researcher notes
    """
    try:
        from ai_hydro.session import HydroSession
        session = HydroSession.load(gauge_id)
        summary = session.summary()
        summary["workspace_dir"] = session.workspace_dir
        return summary
    except Exception as e:
        log.error("get_session_summary failed: %s", e)
        return _tool_error_to_dict(e)


@mcp.tool()
def clear_session(gauge_id: str, slots: list[str] | None = None) -> dict:
    """
    Clear cached results from a session to force re-computation.

    Use when you need to re-run analysis with different parameters,
    or when source data has changed and you want fresh results.
    Notes and workspace_dir are always preserved.

    Parameters
    ----------
    gauge_id : str
        8-digit USGS gauge ID
    slots : list[str], optional
        Specific slots to clear. Valid values:
        watershed, streamflow, signatures, geomorphic, camels, forcing, twi, cn, model.
        Notes and workspace_dir cannot be cleared via this tool — they are always preserved.
        Default: clears ALL data slots (keeps workspace_dir and notes).

    Returns
    -------
    dict with:
        cleared      : list of slot names that were actually cleared
        computed     : remaining computed slots after clearing
        pending      : pending slots after clearing
        workspace_dir: unchanged workspace path

    Examples
    --------
    >>> clear_session('01031500')                          # reset everything
    >>> clear_session('01031500', ['streamflow'])          # re-fetch streamflow only
    >>> clear_session('01031500', ['signatures', 'twi'])   # recompute derived results
    """
    try:
        from ai_hydro.session import HydroSession
        from ai_hydro.session.store import _COMMON_SLOTS as _RESULT_SLOTS
        session = HydroSession.load(gauge_id)
        to_clear = slots if slots else list(_RESULT_SLOTS)
        # Validate slot names
        invalid = [s for s in to_clear if s not in _RESULT_SLOTS]
        if invalid:
            note_hint = (
                " (notes are always preserved and cannot be cleared via slots)"
                if "notes" in invalid else ""
            )
            return {
                "error": True,
                "code": "INVALID_SLOTS",
                "message": (
                    f"Unknown slots: {invalid}. "
                    f"Valid: {list(_RESULT_SLOTS)}{note_hint}"
                ),
            }
        cleared = []
        for slot in to_clear:
            if getattr(session, slot) is not None:
                setattr(session, slot, None)
                cleared.append(slot)
        session.save()
        summary = session.summary()
        summary["cleared"] = cleared
        summary["workspace_dir"] = session.workspace_dir
        return summary
    except Exception as e:
        log.error("clear_session failed: %s", e)
        return _tool_error_to_dict(e)


@mcp.tool()
def add_note(gauge_id: str, note: str) -> dict:
    """
    Add a researcher annotation to the session.

    Parameters
    ----------
    gauge_id : str
        8-digit USGS gauge ID
    note : str
        Annotation text to attach

    Returns
    -------
    dict with updated session summary
    """
    try:
        from ai_hydro.session import HydroSession
        session = HydroSession.load(gauge_id)
        session.notes.append(note)
        session.save()
        return session.summary()
    except Exception as e:
        log.error("add_note failed: %s", e)
        return _tool_error_to_dict(e)


@mcp.tool()
def sync_research_context(
    gauge_id: str,
    interpretation: str | None = None,
    site_name: str | None = None,
) -> dict:
    """
    Two-phase tool: retrieve session data for LLM reasoning, then store
    the LLM-authored scientific interpretation back into the session.

    This is the primary mechanism for making research.md genuinely useful —
    not a template of formatted numbers, but a real scientific summary written
    by the foundation model and loaded into every future conversation.

    Phase 1 — call with no interpretation (discovery):
        Returns the full raw session data across all computed slots.
        Read the numbers, reason about patterns, contradictions, and what
        the hydrology is telling you. Then call Phase 2.

    Phase 2 — call with your interpretation (store):
        Pass your scientific summary as `interpretation`. It is stored in
        the session and embedded in research.md immediately. Every future
        conversation will open with your understanding pre-loaded.

    Parameters
    ----------
    gauge_id : str
        8-digit USGS gauge ID (or site identifier)
    interpretation : str, optional
        Scientific summary authored by the model (Phase 2). Should cover:
        basin behaviour, cross-slot patterns, anomalies, contradictions
        between computed results and researcher notes, and research priorities.
        3-6 sentences. Plain prose, no bullet points.
    site_name : str, optional
        Short descriptive name for this research session, e.g.
        'piscataquis-snowmelt-signatures-2000-2020'. Stored as the session
        display name in research.md and export filenames.

    Returns
    -------
    Phase 1: dict with session_data (all computed slot values), computed,
             pending, notes, and an _instruction guiding the model.
    Phase 2: dict confirming what was written and where.

    Examples
    --------
    # Phase 1: get raw data
    >>> sync_research_context('01031500')

    # Phase 2: store interpretation after reasoning
    >>> sync_research_context(
    ...     '01031500',
    ...     site_name='piscataquis-surface-flow-2000-2020',
    ...     interpretation=(
    ...         "The Piscataquis shows surface-flow dominance (BFI=0.16) "
    ...         "despite humid New England climate, likely driven by shallow "
    ...         "glacial till. Runoff ratio 0.60 is high; FDC slope suggests "
    ...         "moderate flashiness. HBV trained but no validation split — "
    ...         "rerun before interpreting NSE. TWI analysis is highest priority."
    ...     )
    ... )
    """
    try:
        from pathlib import Path
        from ai_hydro.session import HydroSession
        from ai_hydro.session.store import _REPO_ROOT, _RULES_DIR_NAME
        from ai_hydro.mcp.tools_docs import _write_tools_md, _list_tools_sync

        session = HydroSession.load(gauge_id)

        # Phase 2: store interpretation and/or site_name, regenerate research.md
        if interpretation is not None or site_name is not None:
            if interpretation is not None:
                session.interpretation = interpretation.strip()
            if site_name is not None:
                session.site_name = site_name.strip()
            session.save()
            tools_path = _write_tools_md()
            base = Path(session.workspace_dir) if session.workspace_dir else _REPO_ROOT
            research_md_path = base / _RULES_DIR_NAME / "research.md"
            return {
                "stored": True,
                "site_name": session.site_name,
                "interpretation_length": len(session.interpretation),
                "research_md": str(research_md_path),
                "tools_md": str(tools_path),
                "n_tools": len(_list_tools_sync()),
                "_note": (
                    "Interpretation stored. research.md updated — your scientific "
                    "context will be pre-loaded into every future conversation."
                ),
            }

        # Phase 1: return full raw session data for LLM reasoning
        session_data = session.raw_session_data()
        tools_path = _write_tools_md()

        return {
            "gauge_id": gauge_id,
            "site_name": session.site_name or None,
            "computed": session.computed(),
            "pending": session.pending(),
            "notes": session.notes,
            "has_interpretation": bool(session.interpretation),
            "session_data": session_data,
            "n_tools": len(_list_tools_sync()),
            "_instruction": (
                "You have received the full computed session data above. "
                "Read every slot carefully — look for cross-slot patterns, "
                "contradictions between computed values and researcher notes, "
                "what the hydrology is telling you, and what should be done next. "
                "Then call sync_research_context again with: "
                "(1) interpretation=<your 3-6 sentence scientific prose summary> "
                "(2) site_name=<short-descriptive-slug e.g. 'piscataquis-surface-flow-2000-2020'>. "
                "Do not use bullet points in the interpretation — write flowing scientific prose."
            ),
        }
    except Exception as e:
        log.error("sync_research_context failed: %s", e)
        return _tool_error_to_dict(e)


@mcp.tool()
def list_available_tools() -> dict:
    """
    List all MCP tools currently registered on this AI-Hydro server.

    Returns every registered tool with its name, description, and parameter
    schema. Includes both built-in tools and any community plugin tools
    discovered via the aihydro.tools entry point.

    Call this at the start of a session to discover what capabilities are
    available — especially useful when community plugins have been installed.

    Returns
    -------
    dict with keys:
        tools      : list of {name, description, parameters} dicts
        n_tools    : total count of registered tools
        mcp_python : Python interpreter running the MCP server
        note       : guidance on installing additional plugins
    """
    try:
        from ai_hydro.mcp.tools_docs import _list_tools_sync
        tools_raw = _list_tools_sync()
        tools_out = []
        for t in tools_raw:
            entry: dict = {"name": t.name, "description": (t.description or "").strip()}
            if hasattr(t, "parameters") and t.parameters:
                params = {}
                props = getattr(t.parameters, "properties", None) or {}
                for pname, pschema in props.items():
                    params[pname] = {
                        "type": pschema.get("type", "any"),
                        "description": pschema.get("description", ""),
                        "required": pname in (getattr(t.parameters, "required", None) or []),
                    }
                    if "default" in pschema:
                        params[pname]["default"] = pschema["default"]
                entry["parameters"] = params
            tools_out.append(entry)
        return {
            "tools": tools_out,
            "n_tools": len(tools_out),
            "mcp_python": sys.executable,
            "note": (
                "Install community plugins with: pip install <plugin-package>. "
                "Restart the MCP server to discover newly installed plugins."
            ),
        }
    except Exception as e:
        log.error("list_available_tools failed: %s", e)
        return _tool_error_to_dict(e)


@mcp.tool()
def export_session(gauge_id: str, format: str = "json") -> dict:
    """
    Export the full session provenance to a file.

    The export is SAVED TO DISK (not returned inline) to avoid flooding
    the context window. The response contains the file path + a compact
    summary.

    Parameters
    ----------
    gauge_id : str
        8-digit USGS gauge ID
    format : str
        'json'    — full session as JSON (saved to file)
        'bibtex'  — combined BibTeX for all computed results
        'methods' — plain-text methods paragraph per computed tool

    Returns
    -------
    dict with:
        file_saved : path where the export was written
        summary    : compact text preview of the export
    """
    try:
        gauge_id = _validate_gauge_id(gauge_id)
        from ai_hydro.session import HydroSession
        session = HydroSession.load(gauge_id)

        ext = {"json": ".json", "bibtex": ".bib", "methods": ".txt"}.get(format, ".txt")
        filename = f"session_{gauge_id}_{format}{ext}"

        if format == "bibtex":
            content = session.cite_all()
        elif format == "methods":
            lines = [f"Methods for gauge {gauge_id}:"]
            for slot in session.computed():
                result = getattr(session, slot)
                if result:
                    meta = result.get("meta", {})
                    tool = meta.get("tool", slot)
                    params = meta.get("params", {})
                    sources = [s.get("name", "") for s in meta.get("sources", [])]
                    computed_at = meta.get("computed_at", "")[:10]
                    params_str = ", ".join(f"{k}={v!r}" for k, v in params.items())
                    sources_str = ", ".join(sources) if sources else "undocumented"
                    lines.append(
                        f"\n{slot.upper()}: Computed using {tool} with parameters "
                        f"[{params_str}]. Data from: {sources_str}. Date: {computed_at}."
                    )
            content = "\n".join(lines)
        else:
            content = session.to_json()

        # Save to workspace (or ~/.aihydro/exports/ if no workspace)
        saved = _workspace_write(gauge_id, filename, content)
        if not saved:
            export_dir = Path.home() / ".aihydro" / "exports"
            export_dir.mkdir(parents=True, exist_ok=True)
            out_path = export_dir / filename
            with open(out_path, "w") as f:
                f.write(content) if isinstance(content, str) else json.dump(content, f, indent=2)
            saved = str(out_path)

        # Return compact summary — NOT the full content
        summary_parts = [
            f"Gauge: {gauge_id}",
            f"Format: {format}",
            f"Computed slots: {session.computed()}",
            f"Pending slots: {session.pending()}",
            f"File size: {len(content):,} chars",
        ]
        if format == "bibtex":
            n_refs = content.count("@")
            summary_parts.append(f"References: {n_refs}")
        elif format == "methods":
            # Methods text is small enough to include inline
            summary_parts.append(f"Content:\n{content}")

        return {
            "gauge_id": gauge_id,
            "format": format,
            "file_saved": saved,
            "summary": "\n".join(summary_parts),
            "_note": (
                f"Full export saved to {saved}. "
                "Content NOT included in this response to preserve context window."
            ),
        }
    except Exception as e:
        log.error("export_session failed: %s", e)
        return _tool_error_to_dict(e)
