"""
Session management MCP tools (8 tools).

Start, query, clear, annotate, sync, export, and discover research sessions.
"""
from __future__ import annotations

import json
import logging
import subprocess
import sys
from pathlib import Path

from ai_hydro.mcp.app import mcp
from ai_hydro.mcp.helpers import (
    _normalize_session_id,
    _tool_error_to_dict,
    _workspace_write,
)

log = logging.getLogger("ai_hydro.mcp")


@mcp.tool()
def start_session(
    session_id: str | None = None,
    workspace_dir: str | None = None,
) -> dict:
    """
    Start or resume a research session.

    A session is the persistent memory for a study — it stores all computed
    results across tool calls. The session_id can be anything meaningful:
    a slug ("piscataquis-snowmelt-2000-2020"), a USGS gauge number used as
    a shorthand ("01031500"), a UUID, or any unique label. If omitted, one
    is auto-generated ("hydro-<8hex>").

    The session is completely independent of data source — it stores results
    from USGS tools, CSV data, remote sensing outputs, or anything else.

    Parameters
    ----------
    session_id : str, optional
        Unique identifier for this research session. Auto-generated if omitted.
    workspace_dir : str, optional
        Absolute path to the VS Code workspace folder. When provided, all MCP
        tools save output files there automatically. Pass once — remembered for
        all subsequent tool calls on this session.

    Returns
    -------
    dict with session_id, site_name, site_id, computed, pending, workspace_dir,
    mcp_python (the correct interpreter for scripts), and available_packages.
    """
    try:
        from ai_hydro.session import HydroSession
        session_id = _normalize_session_id(session_id)
        session = HydroSession.load(session_id)
        if workspace_dir:
            session.workspace_dir = workspace_dir
        session.save()
        summary = session.summary()
        summary["workspace_dir"] = session.workspace_dir
        summary["mcp_python"] = sys.executable
        pip_path = Path(sys.executable).parent / "pip"
        summary["mcp_pip"] = str(pip_path) if pip_path.exists() else f"{sys.executable} -m pip"
        try:
            result = subprocess.run(
                [sys.executable, "-m", "pip", "list", "--format=json"],
                capture_output=True, text=True, timeout=10,
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
def get_session_summary(session_id: str) -> dict:
    """
    Return what has been computed and what still needs computing.

    Parameters
    ----------
    session_id : str
        Research session identifier.

    Returns
    -------
    dict with session_id, site_name, site_id, computed/pending slot lists,
    researcher notes, and has_interpretation flag.
    """
    try:
        from ai_hydro.session import HydroSession
        session = HydroSession.load(session_id)
        summary = session.summary()
        summary["workspace_dir"] = session.workspace_dir
        return summary
    except Exception as e:
        log.error("get_session_summary failed: %s", e)
        return _tool_error_to_dict(e)


@mcp.tool()
def clear_session(session_id: str, slots: list[str] | None = None) -> dict:
    """
    Clear cached results from a session to force re-computation.

    Notes, workspace_dir, site_name, and interpretation are always preserved.

    Parameters
    ----------
    session_id : str
        Research session identifier.
    slots : list[str], optional
        Specific slots to clear: watershed, streamflow, signatures, geomorphic,
        camels, forcing, twi, cn, model.
        Omit to clear ALL data slots.

    Examples
    --------
    >>> clear_session('piscataquis-study')                        # reset all
    >>> clear_session('piscataquis-study', ['streamflow'])        # re-fetch only
    >>> clear_session('01031500', ['signatures', 'twi'])          # recompute
    """
    try:
        from ai_hydro.session import HydroSession
        from ai_hydro.session.store import _COMMON_SLOTS as _RESULT_SLOTS
        session = HydroSession.load(session_id)
        to_clear = slots if slots else list(_RESULT_SLOTS)
        invalid = [s for s in to_clear if s not in _RESULT_SLOTS]
        if invalid:
            hint = (
                " (notes are always preserved)"
                if "notes" in invalid else ""
            )
            return {
                "error": True,
                "code": "INVALID_SLOTS",
                "message": f"Unknown slots: {invalid}. Valid: {list(_RESULT_SLOTS)}{hint}",
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
def add_note(session_id: str, note: str) -> dict:
    """
    Add a researcher annotation to the session.

    Parameters
    ----------
    session_id : str
        Research session identifier.
    note : str
        Annotation text (hypothesis, anomaly, decision, observation).
    """
    try:
        from ai_hydro.session import HydroSession
        session = HydroSession.load(session_id)
        session.notes.append(note)
        session.save()
        return session.summary()
    except Exception as e:
        log.error("add_note failed: %s", e)
        return _tool_error_to_dict(e)


@mcp.tool()
def sync_research_context(
    session_id: str,
    interpretation: str | None = None,
    site_name: str | None = None,
) -> dict:
    """
    Two-phase tool for LLM-authored scientific interpretation.

    research.md has two sections:
    - Skeleton (Python-generated, always current): computed/pending/notes.
    - Scientific context (LLM-authored): your interpretation, stored here.

    Phase 1 — call with only session_id:
        Returns full raw session data across all computed slots. Read every
        value, look for cross-slot patterns, contradictions with researcher
        notes, and what the science is telling you. Then call Phase 2.

    Phase 2 — call with interpretation + site_name:
        Stores your scientific prose in the session. Embedded in research.md
        immediately. Pre-loaded into every future conversation.

    Parameters
    ----------
    session_id : str
        Research session identifier.
    interpretation : str, optional
        3-6 sentences of scientific prose (Phase 2). Cover: what the data
        shows, cross-slot patterns, contradictions with notes, priorities.
        Write flowing prose — no bullet points.
    site_name : str, optional
        Short descriptive slug: 'piscataquis-snowmelt-signatures-2000-2020'.
        Used as the session display name in research.md and export filenames.

    Examples
    --------
    >>> sync_research_context('01031500')   # Phase 1: get raw data
    >>> sync_research_context(              # Phase 2: store interpretation
    ...     '01031500',
    ...     site_name='piscataquis-surface-flow-2000-2020',
    ...     interpretation='The Piscataquis shows surface-flow dominance...'
    ... )
    """
    try:
        from ai_hydro.session import HydroSession
        from ai_hydro.session.store import _REPO_ROOT, _RULES_DIR_NAME
        from ai_hydro.mcp.tools_docs import _write_tools_md, _list_tools_sync

        session = HydroSession.load(session_id)

        if interpretation is not None or site_name is not None:
            if interpretation is not None:
                session.interpretation = interpretation.strip()
            if site_name is not None:
                session.site_name = site_name.strip()
            session.save()
            tools_path = _write_tools_md()
            base = Path(session.workspace_dir) if session.workspace_dir else _REPO_ROOT
            research_md_path = base / _RULES_DIR_NAME / "research.md"

            # Write citations.bib to workspace
            citations_path: str | None = None
            bib = session.export_bibtex()
            if bib:
                saved = _workspace_write(session_id, "citations.bib", bib)
                citations_path = saved

            n_citations = len(session.get_citations())
            return {
                "stored": True,
                "session_id": session_id,
                "site_name": session.site_name,
                "interpretation_length": len(session.interpretation),
                "research_md": str(research_md_path),
                "tools_md": str(tools_path),
                "n_tools": len(_list_tools_sync()),
                "citations_bib": citations_path,
                "n_data_source_citations": n_citations,
                "_note": (
                    "Interpretation stored. research.md updated — your scientific "
                    "context will be pre-loaded into every future conversation. "
                    f"citations.bib written with {n_citations} data-source entries "
                    "+ 2 platform citations (AI-Hydro + aihydro-tools)."
                ),
            }

        synopsis = session.synopsis_for_llm()
        tools_path = _write_tools_md()
        return {
            "session_id": session_id,
            "site_name": session.site_name or None,
            "site_id": session.site_id or None,
            "computed": session.computed(),
            "pending": session.pending(),
            "notes": session.notes,
            "has_interpretation": bool(session.interpretation),
            "session_synopsis": synopsis,
            "n_tools": len(_list_tools_sync()),
            "_note": (
                "Raw time-series arrays are stored on disk (see _data_file in each slot). "
                "This response contains scientific summaries only — no array data."
            ),
            "_instruction": (
                "You have received a scientific synopsis of all computed session data. "
                "Read every slot carefully — look for cross-slot patterns, "
                "contradictions between computed values and researcher notes, "
                "what the science is telling you, and what the logical next step is. "
                "Then call sync_research_context again with: "
                "(1) interpretation=<your 3-6 sentence scientific prose> "
                "(2) site_name=<short-descriptive-slug>. "
                "Write flowing prose — no bullet points."
            ),
        }
    except Exception as e:
        log.error("sync_research_context failed: %s", e)
        return _tool_error_to_dict(e)


@mcp.tool()
def list_available_tools() -> dict:
    """
    List all MCP tools currently registered on this AI-Hydro server.

    Includes built-in tools and any community plugin tools discovered via
    the aihydro.tools entry point. Always prefer this over documentation
    for an accurate picture of what is installed.
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
def export_session(
    session_id: str,
    format: str = "capsule",
) -> dict:
    """
    Export session as a reproducible research capsule or individual file.

    All output is SAVED TO DISK — never returned inline.

    Parameters
    ----------
    session_id : str
        Research session identifier.
    format : str
        'capsule' (default) — full reproducible research package (folder):
            README.md       — overview + LLM interpretation (if available)
            methods.md      — provenance table for every computed analysis
            citations.bib   — BibTeX for all data sources
            session.json    — complete provenance record
            data/           — JSON/GeoJSON/TIF files from workspace
            figures/        — PNG/HTML figures from workspace
            environment.yml — Python environment specification
        'bibtex' — BibTeX references only
        'json'   — raw session JSON only
    """
    try:
        from ai_hydro.session import HydroSession
        import shutil
        from datetime import datetime

        session = HydroSession.load(session_id)
        today = datetime.now().strftime("%Y-%m-%d")
        slug = session.site_name or session.site_id or session_id
        files_written: list[str] = []

        if format in ("bibtex", "json"):
            content = session.export_bibtex() if format == "bibtex" else session.to_json()
            ext = ".bib" if format == "bibtex" else ".json"
            fname = f"session_{session_id}_{format}{ext}"
            saved = _workspace_write(session_id, fname, content)
            if not saved:
                d = Path.home() / ".aihydro" / "exports"
                d.mkdir(parents=True, exist_ok=True)
                p = d / fname
                p.write_text(content)
                saved = str(p)
            return {"session_id": session_id, "format": format, "file_saved": saved,
                    "computed": session.computed()}

        # Capsule
        base = Path(session.workspace_dir) if session.workspace_dir else Path.home() / ".aihydro" / "exports"
        capsule_dir = base / f"capsule_{slug}_{today}"
        (capsule_dir / "data").mkdir(parents=True, exist_ok=True)
        (capsule_dir / "figures").mkdir(parents=True, exist_ok=True)

        # README.md
        display = session.site_name or session.site_id or session_id
        name_str = ""
        if session.watershed:
            gname = session.watershed.get("data", {}).get("gauge_name", "")
            if gname:
                name_str = f" — {gname}"
        readme = [
            f"# Research Capsule: {display}{name_str}",
            f"**Session ID**: {session_id}",
        ]
        if session.site_id:
            readme.append(f"**Site**: {session.site_id}" +
                          (f" ({session.site_type})" if session.site_type else ""))
        readme += [f"**Exported**: {today}", f"**Platform**: AI-Hydro", "",
                   "## Computed Analyses"]
        for slot in session.computed():
            result = session.get(slot)
            computed_at = (result.get("meta", {}).get("computed_at", "")[:10]
                           if result else "") or "—"
            readme.append(f"- **{slot}** (computed {computed_at})")
        if session.pending():
            readme += ["", "## Pending", ", ".join(session.pending())]
        if session.notes:
            readme += ["", "## Researcher Notes"] + [f"- {n}" for n in session.notes]
        if session.interpretation:
            readme += ["", "## Scientific Summary", session.interpretation]
        else:
            readme += ["", "## Scientific Summary",
                       "_Not yet authored. Call `sync_research_context` to generate._"]
        readme += ["", f"> Generated by AI-Hydro on {today}."]
        (capsule_dir / "README.md").write_text("\n".join(readme))
        files_written.append(str(capsule_dir / "README.md"))

        # methods.md — provenance table
        methods = ["# Methods", "", "## Provenance", "",
                   "| Analysis | Tool | Parameters | Data Source | Date |",
                   "|----------|------|-----------|-------------|------|"]
        for slot in session.computed():
            result = session.get(slot)
            if not result:
                continue
            meta = result.get("meta", {})
            tool = meta.get("tool", slot)
            params = "; ".join(f"{k}={v}" for k, v in meta.get("params", {}).items()) or "—"
            sources = ", ".join(
                s.get("name", s.get("url", "")) for s in meta.get("sources", [])
                if s.get("name") or s.get("url")
            ) or "—"
            date = meta.get("computed_at", "")[:10] or "—"
            methods.append(f"| {slot} | `{tool}` | {params} | {sources} | {date} |")
        methods += ["", "## Methods Prose", "",
                    "_Provenance table above contains all computational metadata. "
                    "Call `sync_research_context` to generate publication-quality "
                    "methods prose, then paste it here._",
                    "", "<!-- Paste LLM-authored methods prose below -->"]
        (capsule_dir / "methods.md").write_text("\n".join(methods))
        files_written.append(str(capsule_dir / "methods.md"))

        # citations.bib
        (capsule_dir / "citations.bib").write_text(session.export_bibtex())
        files_written.append(str(capsule_dir / "citations.bib"))

        # session.json
        (capsule_dir / "session.json").write_text(session.to_json())
        files_written.append(str(capsule_dir / "session.json"))

        # Copy workspace files
        if session.workspace_dir:
            ws = Path(session.workspace_dir)
            for f in ws.iterdir():
                if not f.is_file():
                    continue
                if f.suffix in (".json", ".geojson", ".csv", ".tif", ".tiff"):
                    dest = capsule_dir / "data" / f.name
                    shutil.copy2(f, dest)
                    files_written.append(str(dest))
                elif f.suffix in (".png", ".html", ".svg"):
                    dest = capsule_dir / "figures" / f.name
                    shutil.copy2(f, dest)
                    files_written.append(str(dest))

        # environment.yml
        (capsule_dir / "environment.yml").write_text(_build_environment_yml(slug))
        files_written.append(str(capsule_dir / "environment.yml"))

        needs_interp = not session.interpretation
        return {
            "session_id": session_id,
            "site_name": session.site_name or None,
            "capsule_dir": str(capsule_dir),
            "files": files_written,
            "n_files": len(files_written),
            "computed": session.computed(),
            "_note": (
                "NEXT: call sync_research_context to author the scientific "
                "interpretation, then export again to embed it in README.md."
                if needs_interp else
                "Scientific interpretation included. Add prose to methods.md."
            ),
        }
    except Exception as e:
        log.error("export_session failed: %s", e)
        return _tool_error_to_dict(e)


def _build_environment_yml(name: str) -> str:
    """
    Build a minimal, reproducible environment.yml.

    Strategy (in priority order):
    1. ``conda env export --from-history`` — only explicitly installed packages,
       avoiding the 400-line full-environment dump of ``--no-builds``.
    2. Minimal hand-crafted YAML — used when conda is unavailable or the
       ``--from-history`` output is suspiciously short (< 5 lines).
    """
    import subprocess as _sp

    def _curated() -> str:
        # Get installed versions of core packages for pinning
        versions: dict = {}
        try:
            import importlib.metadata as _imeta
            for pkg in ("aihydro-tools", "numpy", "pandas", "scipy",
                        "torch", "rasterio", "geopandas"):
                try:
                    versions[pkg] = _imeta.version(pkg)
                except Exception:
                    pass
        except Exception:
            pass

        def _pin(pkg: str, fallback: str = "") -> str:
            v = versions.get(pkg)
            return f"    - {pkg}=={v}" if v else (
                f"    - {pkg}>={fallback}" if fallback else f"    - {pkg}"
            )

        lines = [
            f"name: {name}",
            "channels:",
            "  - conda-forge",
            "  - defaults",
            "dependencies:",
            "  - python>=3.10",
            "  - pip",
            "  - pip:",
            _pin("aihydro-tools", "1.4.0"),
            "    - dataretrieval",
            "    - pynhd",
            "    - pygeohydro",
            "    - pygridmet",
            "    - py3dep",
            "    - pysheds",
            _pin("rasterio", "1.3"),
            _pin("geopandas", "0.14"),
            _pin("xarray", ""),
            _pin("numpy", "1.26"),
            _pin("pandas", "2.0"),
            _pin("scipy", "1.11"),
            _pin("torch", "2.0"),
            "    - matplotlib",
            "# Re-create with: conda env create -f environment.yml",
            "# Pin all versions for full reproducibility with: pip freeze > requirements.txt",
        ]
        return "\n".join(lines)

    try:
        r = _sp.run(
            ["conda", "env", "export", "--from-history"],
            capture_output=True, text=True, timeout=15,
        )
        if r.returncode == 0 and r.stdout.strip():
            lines = r.stdout.splitlines()
            # from-history output is only meaningful if it lists actual packages
            # (sometimes it returns just name/channels/prefix with no deps)
            has_deps = any(
                line.strip() and not line.startswith(("name:", "channels:",
                                                       "dependencies:", "prefix:", "-"))
                for line in lines
            )
            if len(lines) >= 8 or has_deps:
                if lines and lines[0].startswith("name:"):
                    lines[0] = f"name: {name}"
                # Strip the absolute prefix line — breaks portability
                lines = [l for l in lines if not l.startswith("prefix:")]
                return "\n".join(lines)
    except Exception:
        pass

    return _curated()
