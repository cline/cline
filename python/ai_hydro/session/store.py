"""
AI-Hydro Research Session (HydroSession)
==========================================

Persistent research state across MCP tool calls.

The primary key is ``session_id`` — any string the researcher or LLM chooses.
It can be a slug ("piscataquis-snowmelt-2020"), a UUID, a USGS gauge number
used as a shorthand ("01031500"), or anything else meaningful to the study.

``site_id`` and ``site_type`` are optional metadata describing the data source
(e.g., a USGS gauge number, GRDC station, DEM tile). They are NOT the session
identity — the session identity is ``session_id``.

Storage: ~/.aihydro/sessions/<session_id>.json

Dynamic slots
-------------
Plugins can register their own result slots without editing core code:
    session.set("my_plugin_result", {...})
    session.get("my_plugin_result")  # → dict or None
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

_SESSIONS_DIR = Path.home() / ".aihydro" / "sessions"
_REPO_ROOT = Path(__file__).resolve().parent.parent.parent.parent
_RULES_DIR_NAME = ".aihydrorules"

# Lists longer than this are stripped from the session JSON on disk.
# They are replaced by a ``{key}_n`` count key so the record stays
# interpretable without the full array.
_ARRAY_STRIP_THRESHOLD = 50

# Common slot names corresponding to built-in MCP tools.
_COMMON_SLOTS = (
    "watershed",
    "streamflow",
    "signatures",
    "geomorphic",
    "camels",
    "forcing",
    "twi",
    "cn",
    "model",
)


def _lean_slot(val: Any) -> Any:
    """
    Return a disk-safe (lean) copy of a slot value.

    Strips any list longer than ``_ARRAY_STRIP_THRESHOLD`` from the ``data``
    sub-dict, replacing it with a ``{key}_n`` count key so the record stays
    interpretable. The ``meta`` sub-dict and scalar ``data`` values are kept
    verbatim. Private keys (``_data_file`` etc.) are preserved.

    The in-memory ``_slots`` dict is never modified — stripping only happens
    when serialising to JSON via ``_to_raw()``.
    """
    if val is None:
        return None
    if not isinstance(val, dict):
        return val
    # Model slot may store data directly (no data/meta wrapper) — handle both
    if "data" not in val:
        # Flat dict (legacy model slot) — strip large lists in-place copy
        lean: dict = {}
        for k, v in val.items():
            if isinstance(v, list) and len(v) > _ARRAY_STRIP_THRESHOLD:
                lean[f"{k}_n"] = len(v)
            else:
                lean[k] = v
        return lean
    lean_data: dict = {}
    for k, v in val["data"].items():
        if isinstance(v, list) and len(v) > _ARRAY_STRIP_THRESHOLD:
            lean_data[f"{k}_n"] = len(v)
        else:
            lean_data[k] = v
    return {**val, "data": lean_data}


class HydroSession:
    """Persistent research state for a single study across tool calls."""

    def __init__(self, session_id: str) -> None:
        self.session_id: str = session_id
        # Display name — LLM-generated slug describing the research
        # e.g. "piscataquis-snowmelt-signatures-2000-2020"
        self.site_name: str = ""
        # Data source identifier — e.g. USGS gauge "01031500", GRDC "6335060"
        # Optional: may be empty for remote sensing, CSV, or ungauged studies
        self.site_id: str = ""
        # Data source type — "usgs_gauge" | "grdc_station" | "ungauged" | "csv" | ...
        self.site_type: str = ""
        self.workspace_dir: str | None = None
        self._slots: dict[str, dict | None] = {}
        self.notes: list[str] = []
        # LLM-authored scientific interpretation — written via sync_research_context
        self.interpretation: str = ""
        self.created_at: str = datetime.now(timezone.utc).isoformat()
        self.updated_at: str = self.created_at

    # ------------------------------------------------------------------
    # Backward-compat property: gauge_id → site_id (or session_id)
    # Kept so legacy callers that read session.gauge_id still work.
    # ------------------------------------------------------------------

    @property
    def gauge_id(self) -> str:
        """Backward-compat alias — returns site_id if set, else session_id."""
        return self.site_id or self.session_id

    # ------------------------------------------------------------------
    # Dynamic slot access
    # ------------------------------------------------------------------

    def set(self, slot: str, value: dict | None) -> None:
        self._slots[slot] = value

    def get(self, slot: str) -> dict | None:
        return self._slots.get(slot)

    # ------------------------------------------------------------------
    # Backward-compat property accessors for the 9 common slots
    # ------------------------------------------------------------------

    @property
    def watershed(self) -> dict | None:
        return self.get("watershed")

    @watershed.setter
    def watershed(self, v: dict | None) -> None:
        self.set("watershed", v)

    @property
    def streamflow(self) -> dict | None:
        return self.get("streamflow")

    @streamflow.setter
    def streamflow(self, v: dict | None) -> None:
        self.set("streamflow", v)

    @property
    def signatures(self) -> dict | None:
        return self.get("signatures")

    @signatures.setter
    def signatures(self, v: dict | None) -> None:
        self.set("signatures", v)

    @property
    def geomorphic(self) -> dict | None:
        return self.get("geomorphic")

    @geomorphic.setter
    def geomorphic(self, v: dict | None) -> None:
        self.set("geomorphic", v)

    @property
    def camels(self) -> dict | None:
        return self.get("camels")

    @camels.setter
    def camels(self, v: dict | None) -> None:
        self.set("camels", v)

    @property
    def forcing(self) -> dict | None:
        return self.get("forcing")

    @forcing.setter
    def forcing(self, v: dict | None) -> None:
        self.set("forcing", v)

    @property
    def twi(self) -> dict | None:
        return self.get("twi")

    @twi.setter
    def twi(self, v: dict | None) -> None:
        self.set("twi", v)

    @property
    def cn(self) -> dict | None:
        return self.get("cn")

    @cn.setter
    def cn(self, v: dict | None) -> None:
        self.set("cn", v)

    @property
    def model(self) -> dict | None:
        return self.get("model")

    @model.setter
    def model(self, v: dict | None) -> None:
        self.set("model", v)

    # ------------------------------------------------------------------
    # Persistence
    # ------------------------------------------------------------------

    @classmethod
    def _path(cls, session_id: str) -> Path:
        return _SESSIONS_DIR / f"{session_id}.json"

    @classmethod
    def load(cls, session_id: str) -> HydroSession:
        """Load an existing session, or return a new empty one."""
        path = cls._path(session_id)
        if not path.exists():
            return cls(session_id)
        with open(path) as f:
            raw = json.load(f)
        session = cls(session_id)
        _META_KEYS = {
            "session_id", "site_name", "site_id", "site_type",
            "workspace_dir", "notes", "created_at", "updated_at", "interpretation",
            # legacy keys — kept for loading old session files
            "gauge_id",
        }
        for key, val in raw.items():
            if key in _META_KEYS:
                continue
            if isinstance(val, dict) or val is None:
                session.set(key, val)
        session.site_name = raw.get("site_name", "")
        # Support legacy "gauge_id" key in old session files
        session.site_id = raw.get("site_id", "") or raw.get("gauge_id", "")
        session.site_type = raw.get("site_type", "")
        session.workspace_dir = raw.get("workspace_dir")
        session.notes = raw.get("notes", [])
        session.interpretation = raw.get("interpretation", "")
        session.created_at = raw.get("created_at", session.created_at)
        session.updated_at = raw.get("updated_at", session.updated_at)
        return session

    def save(self) -> None:
        self.updated_at = datetime.now(timezone.utc).isoformat()
        _SESSIONS_DIR.mkdir(parents=True, exist_ok=True)
        with open(self._path(self.session_id), "w") as f:
            json.dump(self._to_raw(), f, indent=2)
        self.write_research_context()

    def _to_raw(self) -> dict:
        raw: dict[str, Any] = {
            "session_id": self.session_id,
            "site_name": self.site_name,
            "site_id": self.site_id,
            "site_type": self.site_type,
            "workspace_dir": self.workspace_dir,
            "created_at": self.created_at,
            "updated_at": self.updated_at,
            "notes": self.notes,
            "interpretation": self.interpretation,
        }
        for slot, val in self._slots.items():
            raw[slot] = _lean_slot(val)
        return raw

    # ------------------------------------------------------------------
    # Workspace file writing
    # ------------------------------------------------------------------

    def write_workspace_file(self, filename: str, content: Any) -> str | None:
        if not self.workspace_dir:
            return None
        out_path = Path(self.workspace_dir) / filename
        out_path.parent.mkdir(parents=True, exist_ok=True)
        with open(out_path, "w") as f:
            if isinstance(content, str):
                f.write(content)
            else:
                json.dump(content, f, indent=2)
        return str(out_path)

    # ------------------------------------------------------------------
    # Query helpers
    # ------------------------------------------------------------------

    def computed(self) -> list[str]:
        return [k for k, v in self._slots.items() if v is not None]

    def pending(self) -> list[str]:
        return [s for s in _COMMON_SLOTS if self.get(s) is None]

    def summary(self) -> dict:
        return {
            "session_id": self.session_id,
            "site_name": self.site_name,
            "site_id": self.site_id,
            "site_type": self.site_type,
            "computed": self.computed(),
            "pending": self.pending(),
            "notes": self.notes,
            "has_interpretation": bool(self.interpretation),
            "created_at": self.created_at,
            "updated_at": self.updated_at,
        }

    def to_json(self) -> str:
        return json.dumps(self._to_raw(), indent=2)

    def cite_all(self) -> str:
        entries: list[str] = []
        for slot in self.computed():
            result = self.get(slot)
            if not result:
                continue
            for src in result.get("meta", {}).get("sources", []):
                citation = src.get("citation")
                if citation and citation not in entries:
                    entries.append(citation)
        if not entries:
            return f"% No citations available for session {self.session_id}"
        return "\n\n".join(entries)

    def synopsis_for_llm(self) -> dict:
        """
        Concise per-slot summaries for LLM reasoning — never returns raw arrays.

        Each slot becomes a flat dict of scalars + short lists only.
        Large time-series arrays are replaced by their element count so the LLM
        knows they exist without being overwhelmed by the data.

        Returned by ``sync_research_context`` Phase 1 so the LLM can reason
        across all computed results before writing an interpretation.
        """
        out: dict = {}
        for slot in self.computed():
            result = self.get(slot)
            if not result:
                continue
            data = result.get("data", {})
            meta = result.get("meta", {})
            synopsis: dict = {}
            # Flat scalars and short lists only; strip large arrays
            for k, v in data.items():
                if k.startswith("_"):
                    continue  # private implementation keys
                if isinstance(v, list):
                    if len(v) > _ARRAY_STRIP_THRESHOLD:
                        synopsis[f"{k}_n"] = len(v)
                    else:
                        synopsis[k] = v
                elif isinstance(v, dict):
                    # Keep nested dicts (e.g. attribute_groups, calibrated_params)
                    # but strip any large list values inside them
                    synopsis[k] = {
                        dk: (dv if not (isinstance(dv, list) and
                                        len(dv) > _ARRAY_STRIP_THRESHOLD)
                             else f"[{len(dv)} items]")
                        for dk, dv in v.items()
                    }
                else:
                    synopsis[k] = v
            # Attach lightweight provenance
            computed_at = meta.get("computed_at", "")
            synopsis["_computed_at"] = computed_at[:10] if computed_at else None
            synopsis["_tool"] = meta.get("tool", slot)
            if meta.get("params"):
                synopsis["_params"] = meta["params"]
            out[slot] = synopsis
        return out

    def raw_session_data(self) -> dict:
        """
        Backward-compat alias → synopsis_for_llm().

        Returns lean per-slot summaries (no raw arrays).
        Previously returned the full data dict including arrays;
        callers that needed raw arrays should load from ``_data_file``.
        """
        return self.synopsis_for_llm()

    # ------------------------------------------------------------------
    # research.md sync
    # ------------------------------------------------------------------

    def write_research_context(self) -> None:
        """
        Write research.md to .aihydrorules/ for VS Code context injection.

        Section 1 — Python skeleton (always current on every save):
            site identity, computed/pending slots, researcher notes.
        Section 2 — LLM interpretation (written via sync_research_context):
            scientific summary authored by the foundation model.
        """
        display = self.site_name or self.site_id or self.session_id
        name_str = self._display_name_str()
        computed = self.computed()
        pending  = self.pending()

        lines: list[str] = [
            "# Research Session",
            f"**Session**: {display}{name_str}",
            f"**ID**: {self.session_id}",
        ]
        if self.site_id:
            lines.append(f"**Site**: {self.site_id}" +
                         (f" ({self.site_type})" if self.site_type else ""))
        lines += [f"**Updated**: {self.updated_at[:10]}", ""]

        if computed:
            lines.append(f"**Computed** ({len(computed)}): " + ", ".join(computed))
        if pending:
            lines.append(f"**Pending** ({len(pending)}): " + ", ".join(pending))
        lines.append("")

        if self.notes:
            lines.append("## Researcher Notes")
            for note in self.notes:
                lines.append(f"- {note}")
            lines.append("")

        try:
            from ai_hydro.session.persona import ResearcherProfile
            profile = ResearcherProfile.load()
            if not profile.is_blank():
                lines.append(profile.to_context_string())
                lines.append("")
        except Exception:
            pass

        if self.interpretation:
            lines.append("## Scientific Context")
            lines.append(self.interpretation)
            lines.append("")
        else:
            lines.append(
                "_No scientific interpretation yet — call `sync_research_context` "
                "to generate one._"
            )
            lines.append("")

        lines.append(
            "> *Skeleton auto-generated by HydroSession. "
            "Scientific context authored by the LLM via `sync_research_context`.*"
        )

        base = Path(self.workspace_dir) if self.workspace_dir else _REPO_ROOT
        research_md = base / _RULES_DIR_NAME / "research.md"
        research_md.parent.mkdir(parents=True, exist_ok=True)
        research_md.write_text("\n".join(lines))

    def _display_name_str(self) -> str:
        """Parenthetical station name from watershed metadata if available."""
        if self.watershed:
            name = self.watershed.get("data", {}).get("gauge_name", "")
            if name and name not in (self.site_name, self.site_id, self.session_id):
                return f" ({name})"
        return ""
