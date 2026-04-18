"""
AI-Hydro Researcher Profile
============================
Persistent researcher persona — domain expertise, preferences, and agent
observations accumulated over time, similar to memory features in Claude.ai
and ChatGPT but domain-specific to computational hydrology research.

The profile is GLOBAL (not per-project) so the agent carries knowledge of
who the researcher is across all projects and conversations.

The agent should update this profile proactively when it learns something
meaningful about the researcher — their background, preferred tools, current
focus, working style. Updates should be sparse and substantive, not logged
for every trivial interaction.

Storage: ~/.aihydro/researcher.json
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

_PROFILE_PATH = Path.home() / ".aihydro" / "researcher.json"

# Project root: python/ai_hydro/session/persona.py → up 4 levels
_PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent.parent
_RESEARCH_MD = _PROJECT_ROOT / ".aihydrorules" / "research.md"


class ResearcherProfile:
    """
    Persistent researcher persona updated by the agent from interactions.

    Fields
    ------
    name : str | None
        Researcher's name.
    institution : str | None
        University, agency, or company.
    role : str | None
        e.g. "PhD student", "postdoc", "hydrological consultant", "professor"
    domain : str | None
        Primary scientific domain, e.g. "hydrology", "geomorphology",
        "remote sensing", "climate science"
    expertise : list[str]
        Specific technical areas the researcher is proficient in,
        e.g. ["LSTM", "CAMELS", "flood frequency analysis", "GIS"]
    tools_familiarity : dict[str, str]
        {tool_name: level} where level is "beginner", "intermediate", "expert"
        e.g. {"python": "expert", "matlab": "intermediate", "R": "beginner"}
    preferred_models : list[str]
        Hydrological models the researcher prefers or has used,
        e.g. ["HBV", "VIC", "LSTM"]
    research_focus : str | None
        Current research focus in plain language.
        e.g. "Prediction in ungauged basins using transfer learning"
    active_project : str | None
        Name of the currently active AI-Hydro project (if any).
    communication_style : str | None
        How the researcher prefers responses:
        e.g. "concise technical", "detailed explanations", "visual outputs"
    observations : list[str]
        Agent-logged observations from interactions — things the researcher
        said, preferences revealed, domain knowledge demonstrated. Kept
        sparse (max ~20 entries). Oldest are pruned when limit is reached.
    updated_at : str
        ISO timestamp of last update.
    """

    MAX_OBSERVATIONS = 20

    def __init__(self) -> None:
        self.name: str | None = None
        self.institution: str | None = None
        self.role: str | None = None
        self.domain: str | None = None
        self.expertise: list[str] = []
        self.tools_familiarity: dict[str, str] = {}
        self.preferred_models: list[str] = []
        self.research_focus: str | None = None
        self.active_project: str | None = None
        self.communication_style: str | None = None
        self.observations: list[str] = []
        self.updated_at: str = datetime.now(timezone.utc).isoformat()

    # ------------------------------------------------------------------
    # Persistence
    # ------------------------------------------------------------------

    @classmethod
    def load(cls) -> ResearcherProfile:
        """Load from disk, or return a blank profile if none exists yet."""
        if not _PROFILE_PATH.exists():
            return cls()
        with open(_PROFILE_PATH) as f:
            raw = json.load(f)
        p = cls()
        for field in (
            "name", "institution", "role", "domain", "research_focus",
            "active_project", "communication_style", "updated_at",
        ):
            if field in raw:
                setattr(p, field, raw[field])
        p.expertise = raw.get("expertise", [])
        p.tools_familiarity = raw.get("tools_familiarity", {})
        p.preferred_models = raw.get("preferred_models", [])
        p.observations = raw.get("observations", [])
        return p

    def save(self) -> None:
        self.updated_at = datetime.now(timezone.utc).isoformat()
        _PROFILE_PATH.parent.mkdir(parents=True, exist_ok=True)
        with open(_PROFILE_PATH, "w") as f:
            json.dump(self._to_raw(), f, indent=2)

    def _to_raw(self) -> dict:
        return {
            "name": self.name,
            "institution": self.institution,
            "role": self.role,
            "domain": self.domain,
            "research_focus": self.research_focus,
            "active_project": self.active_project,
            "communication_style": self.communication_style,
            "expertise": self.expertise,
            "tools_familiarity": self.tools_familiarity,
            "preferred_models": self.preferred_models,
            "observations": self.observations,
            "updated_at": self.updated_at,
        }

    # ------------------------------------------------------------------
    # Update helpers
    # ------------------------------------------------------------------

    def update(self, **kwargs) -> list[str]:
        """
        Update one or more fields. Returns list of fields actually changed.

        List fields (expertise, preferred_models, observations) support
        append semantics: pass a single string to add to the list rather
        than replace it.
        """
        changed = []
        list_fields = {"expertise", "preferred_models"}
        dict_fields = {"tools_familiarity"}

        for k, v in kwargs.items():
            if not hasattr(self, k):
                continue
            current = getattr(self, k)

            if k in list_fields:
                # Append if string, extend if list, replace if explicitly a list
                if isinstance(v, str) and v not in current:
                    current.append(v)
                    changed.append(k)
                elif isinstance(v, list):
                    for item in v:
                        if item not in current:
                            current.append(item)
                    changed.append(k)
            elif k in dict_fields:
                # Merge dicts
                if isinstance(v, dict):
                    current.update(v)
                    changed.append(k)
            else:
                if current != v:
                    setattr(self, k, v)
                    changed.append(k)

        return changed

    def add_observation(self, text: str) -> None:
        """
        Log an agent observation about the researcher.

        Observations are pruned to MAX_OBSERVATIONS, keeping the most recent.
        """
        ts = datetime.now(timezone.utc).isoformat()[:10]
        entry = f"[{ts}] {text}"
        self.observations.append(entry)
        if len(self.observations) > self.MAX_OBSERVATIONS:
            self.observations = self.observations[-self.MAX_OBSERVATIONS:]

    # ------------------------------------------------------------------
    # Query helpers
    # ------------------------------------------------------------------

    def is_blank(self) -> bool:
        """True if no meaningful fields are populated yet."""
        return all([
            not self.name,
            not self.role,
            not self.domain,
            not self.expertise,
            not self.research_focus,
        ])

    def summary(self) -> dict:
        return self._to_raw()

    def to_context_string(self) -> str:
        """
        Format the profile as a markdown block for injection into the
        agent's context (e.g. in .aihydrorules/research.md).
        """
        if self.is_blank():
            return (
                "## Researcher Profile\n"
                "_Not yet configured. The agent will build this profile "
                "over time from your interactions, or you can call "
                "`update_researcher_profile` to fill it in._"
            )

        lines = ["## Researcher Profile"]
        if self.name:
            lines.append(f"**Name**: {self.name}")
        if self.role:
            lines.append(f"**Role**: {self.role}")
        if self.institution:
            lines.append(f"**Institution**: {self.institution}")
        if self.domain:
            lines.append(f"**Domain**: {self.domain}")
        if self.research_focus:
            lines.append(f"**Current focus**: {self.research_focus}")
        if self.active_project:
            lines.append(f"**Active project**: {self.active_project}")
        if self.expertise:
            lines.append(f"**Expertise**: {', '.join(self.expertise)}")
        if self.preferred_models:
            lines.append(f"**Preferred models**: {', '.join(self.preferred_models)}")
        if self.tools_familiarity:
            tools = ", ".join(f"{k} ({v})" for k, v in self.tools_familiarity.items())
            lines.append(f"**Tools**: {tools}")
        if self.communication_style:
            lines.append(f"**Communication style**: {self.communication_style}")
        if self.observations:
            lines.append("\n**Agent observations**:")
            for obs in self.observations[-5:]:
                lines.append(f"- {obs}")

        return "\n".join(lines)
