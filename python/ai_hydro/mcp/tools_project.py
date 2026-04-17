"""
Project, Literature, and Researcher Profile MCP tools (v1.2).

10 tools across three groups:

PROJECT MANAGEMENT (4)
  start_project            — create / resume a named research project
  get_project_summary      — overview of all sessions, journal, literature
  add_session_to_project   — associate any research session with a project
  search_experiments       — full-text search across all project sessions

LITERATURE (3)
  index_literature       — scan a folder of papers → build searchable index
  search_literature      — query the index; returns excerpts for agent synthesis
  add_journal_entry      — log a timestamped research note to the project journal

RESEARCHER PROFILE (3)
  get_researcher_profile     — return the persistent researcher persona
  update_researcher_profile  — update specific fields (agent or user driven)
  log_researcher_observation — agent logs an observation about the researcher
"""

from __future__ import annotations

import json
import logging
from pathlib import Path

from ai_hydro.mcp.app import mcp
from ai_hydro.mcp.helpers import _tool_error_to_dict

log = logging.getLogger("ai_hydro.mcp")

# ---------------------------------------------------------------------------
# PROJECT MANAGEMENT
# ---------------------------------------------------------------------------


@mcp.tool()
def start_project(
    name: str,
    description: str = "",
    topics: list[str] | None = None,
) -> dict:
    """
    Create or resume a named research project.

    A project is the top-level unit of research in AI-Hydro v1.2+. It spans
    multiple gauges, a literature folder, and a persistent experiment journal.
    Unlike gauge sessions (which are tied to a specific USGS gauge), a project
    can cover any hydrological topic — ungauged basins, remote sensing, global
    datasets, conceptual work — with no gauge required.

    On first call: creates the project and sets it as the active project in
    the researcher profile.
    On subsequent calls: loads existing project and returns its current state.

    Parameters
    ----------
    name : str
        Short project name used as a directory key, e.g. "camels_lstm_study"
        or "alpine_snowmelt_thesis". No spaces — use underscores.
    description : str, optional
        One-sentence description of the project.
    topics : list[str], optional
        Topic tags, e.g. ["LSTM", "ungauged basins", "CAMELS-US"].

    Returns
    -------
    dict with project summary + literature_dir path + active status.
    """
    try:
        from ai_hydro.session.project import ProjectSession
        from ai_hydro.session.persona import ResearcherProfile

        project = ProjectSession.load(name)
        is_new = not ProjectSession._path(name).exists()

        if description:
            project.description = description
        if topics:
            for t in topics:
                if t not in project.topics:
                    project.topics.append(t)

        # Ensure literature folder exists
        project.literature_path.mkdir(parents=True, exist_ok=True)

        project.save()

        # Mark as active project in researcher profile
        profile = ResearcherProfile.load()
        profile.update(active_project=name)
        profile.save()

        result = project.summary()
        result["is_new"] = is_new
        result["status"] = "created" if is_new else "resumed"
        result["literature_dir"] = str(project.literature_path)
        result["tip"] = (
            f"Drop papers/documents into {project.literature_path} "
            "then call index_literature to make them searchable."
        )
        return result
    except Exception as e:
        log.error("start_project failed: %s", e)
        return _tool_error_to_dict(e)


@mcp.tool()
def get_project_summary(project_name: str) -> dict:
    """
    Return a full overview of a research project.

    Includes all associated gauge sessions (with their computed/pending slots
    and key metrics), recent journal entries, literature status, and project
    metadata.

    Parameters
    ----------
    project_name : str
        Project name as given to start_project.

    Returns
    -------
    dict with project metadata, gauge_summaries, recent_journal, literature_status.
    """
    try:
        from ai_hydro.session.project import ProjectSession

        project = ProjectSession.load(project_name)
        summary = project.summary()
        summary["session_summaries"] = project.session_summaries()
        summary["recent_journal"] = project.journal[-5:] if project.journal else []
        summary["notes"] = project.notes

        # Literature status
        lit_dir = project.literature_path
        if lit_dir.exists():
            docs = [f.name for f in lit_dir.iterdir()
                    if f.suffix.lower() in (".pdf", ".txt", ".md", ".docx")]
            summary["literature_files"] = docs
            summary["literature_indexed"] = project.literature_index_path.exists()
        else:
            summary["literature_files"] = []
            summary["literature_indexed"] = False

        return summary
    except Exception as e:
        log.error("get_project_summary failed: %s", e)
        return _tool_error_to_dict(e)


@mcp.tool()
def add_session_to_project(project_name: str, session_id: str) -> dict:
    """
    Associate a research session with a project.

    This creates the link between a project and an existing (or future)
    research session. The session does not need to exist yet — you can
    pre-register sessions you plan to study. Sessions can represent any
    research context: USGS gauges, GRDC stations, ungauged basins, or any
    other hydrological study.

    Parameters
    ----------
    project_name : str
        Project name as given to start_project.
    session_id : str
        Research session identifier (any string — slug, gauge ID, UUID).

    Returns
    -------
    dict with updated project session list.
    """
    try:
        from ai_hydro.session.project import ProjectSession

        project = ProjectSession.load(project_name)
        added = project.add_session(session_id)
        project.save()

        return {
            "project": project_name,
            "session_id": session_id,
            "added": added,
            "all_sessions": project.session_ids,
            "message": (
                f"Session '{session_id}' {'added to' if added else 'already in'} "
                f"project '{project_name}'."
            ),
        }
    except Exception as e:
        log.error("add_session_to_project failed: %s", e)
        return _tool_error_to_dict(e)


@mcp.tool()
def search_experiments(
    project_name: str,
    query: str,
    compare_sessions: bool = False,
) -> dict:
    """
    Search across all gauge sessions in a project.

    Performs a full-text search over the JSON representation of every computed
    result slot across all gauges in the project. Useful for questions like:
      - "which gauges have high baseflow index?"
      - "show me all gauges where I ran an LSTM model"
      - "find basins with NSE > 0.7"

    When compare_gauges=True, also returns a side-by-side metric table for
    all gauges that have signature and model results.

    Parameters
    ----------
    project_name : str
        Project name.
    query : str
        Search term to match against stored results (case-insensitive).
    compare_sessions : bool, optional
        If True, include a side-by-side comparison table. Default False.

    Returns
    -------
    dict with:
        matches       : list of {gauge_id, slot, snippet} for each match
        n_matches     : total number of matches
        comparison    : side-by-side table (only if compare_gauges=True)
    """
    try:
        from ai_hydro.session.project import ProjectSession

        project = ProjectSession.load(project_name)
        matches = project.search_experiments(query)

        result: dict = {
            "project": project_name,
            "query": query,
            "n_sessions_searched": len(project.session_ids),
            "n_matches": len(matches),
            "matches": matches,
        }

        if compare_sessions:
            result["comparison"] = project.compare_sessions()

        return result
    except Exception as e:
        log.error("search_experiments failed: %s", e)
        return _tool_error_to_dict(e)


# ---------------------------------------------------------------------------
# LITERATURE
# ---------------------------------------------------------------------------


@mcp.tool()
def index_literature(
    project_name: str,
    folder_path: str | None = None,
) -> dict:
    """
    Scan a folder of research papers and build a searchable index.

    Reads .txt, .md, and .pdf files (PDF requires the 'pypdf' package).
    Creates literature_index.md in the project directory containing file
    names, detected titles, and the first ~800 characters of each document.

    This index is what search_literature queries — it is fast (plain text,
    no vector database), and the agent reads the relevant excerpts from the
    full files when deeper content is needed.

    Call this whenever you add new papers to the folder.

    Parameters
    ----------
    project_name : str
        Project name.
    folder_path : str, optional
        Path to folder containing papers. Defaults to the project's built-in
        literature/ folder (~/.aihydro/projects/<name>/literature/).

    Returns
    -------
    dict with n_files indexed, file list, and index path.
    """
    try:
        from ai_hydro.session.project import ProjectSession

        project = ProjectSession.load(project_name)

        # Resolve folder
        if folder_path:
            lit_dir = Path(folder_path).expanduser().resolve()
            project.literature_dir = str(lit_dir)
        else:
            lit_dir = project.literature_path
            lit_dir.mkdir(parents=True, exist_ok=True)

        if not lit_dir.exists():
            return {
                "error": True,
                "message": f"Folder not found: {lit_dir}",
            }

        # Gather files
        supported = {".txt", ".md", ".pdf"}
        files = [f for f in lit_dir.iterdir() if f.suffix.lower() in supported]

        if not files:
            return {
                "project": project_name,
                "folder": str(lit_dir),
                "n_files": 0,
                "message": (
                    f"No supported files found in {lit_dir}. "
                    "Drop .txt, .md, or .pdf files there and re-run."
                ),
            }

        # Build index
        index_lines = [
            f"# Literature Index — {project_name}",
            f"*{len(files)} documents indexed from {lit_dir}*",
            f"*Last updated: {__import__('datetime').datetime.now().isoformat()[:10]}*",
            "",
        ]

        indexed = []
        skipped = []

        for fpath in sorted(files):
            content = _read_document(fpath)
            if content is None:
                skipped.append(fpath.name)
                continue

            # Trim to ~800 chars for the index
            excerpt = content[:800].replace("\n", " ").strip()
            if len(content) > 800:
                excerpt += "…"

            index_lines += [
                f"## {fpath.name}",
                f"**Path**: `{fpath}`",
                f"**Excerpt**: {excerpt}",
                "",
            ]
            indexed.append(fpath.name)

        # Write index
        index_path = project.literature_index_path
        index_path.write_text("\n".join(index_lines))

        project.save()

        return {
            "project": project_name,
            "folder": str(lit_dir),
            "n_files": len(indexed),
            "indexed": indexed,
            "skipped": skipped,
            "index_path": str(index_path),
            "message": (
                f"Indexed {len(indexed)} documents. "
                "Use search_literature to query them."
            ),
        }
    except Exception as e:
        log.error("index_literature failed: %s", e)
        return _tool_error_to_dict(e)


def _read_document(path: Path) -> str | None:
    """Read a document to text. Returns None if unreadable."""
    suffix = path.suffix.lower()
    try:
        if suffix in (".txt", ".md"):
            return path.read_text(errors="replace")
        elif suffix == ".pdf":
            try:
                import pypdf
                reader = pypdf.PdfReader(str(path))
                pages = [page.extract_text() or "" for page in reader.pages]
                return "\n".join(pages)
            except ImportError:
                try:
                    import pdfplumber
                    with pdfplumber.open(str(path)) as pdf:
                        pages = [p.extract_text() or "" for p in pdf.pages]
                    return "\n".join(pages)
                except ImportError:
                    log.warning(
                        "PDF reading requires 'pypdf' or 'pdfplumber'. "
                        "Install with: pip install pypdf"
                    )
                    return f"[PDF: {path.name} — install pypdf to index PDFs]"
    except Exception as e:
        log.warning("Could not read %s: %s", path, e)
        return None


@mcp.tool()
def search_literature(
    project_name: str,
    query: str,
    return_full_content: bool = False,
) -> dict:
    """
    Query the literature index for papers matching a topic or question.

    Searches the index for matching document names and excerpts. If
    return_full_content=True, reads and returns the full text of matching
    documents so the agent can synthesize across them.

    No vector embeddings — just fast text matching on the index, with the
    LLM doing the synthesis. Works entirely offline after indexing.

    Parameters
    ----------
    project_name : str
        Project name.
    query : str
        Topic, term, or question to search for, e.g.
        "baseflow recession analysis", "LSTM vs HBV performance",
        "CAMELS benchmark results".
    return_full_content : bool, optional
        If True, return full document text for matched files (may be large).
        Default False — returns index excerpts only.

    Returns
    -------
    dict with:
        matches       : list of {filename, excerpt} for matched documents
        n_matches     : number of matched documents
        full_content  : {filename: full_text} if return_full_content=True
        suggestion    : synthesis prompt for the agent
    """
    try:
        from ai_hydro.session.project import ProjectSession

        project = ProjectSession.load(project_name)

        if not project.literature_index_path.exists():
            return {
                "indexed": False,
                "message": (
                    "Literature not indexed yet. "
                    "Run index_literature first."
                ),
                "n_matches": 0,
                "matches": [],
            }

        index_text = project.literature_index_path.read_text()
        q = query.lower()

        # Parse index sections (each file starts with ## filename)
        sections: list[dict] = []
        current: dict | None = None
        for line in index_text.splitlines():
            if line.startswith("## "):
                if current:
                    sections.append(current)
                current = {"filename": line[3:].strip(), "lines": []}
            elif current is not None:
                current["lines"].append(line)
        if current:
            sections.append(current)

        # Match sections where query appears
        matches = []
        for sec in sections:
            blob = " ".join(sec["lines"]).lower()
            if q in blob or q in sec["filename"].lower():
                excerpt_line = next(
                    (l for l in sec["lines"] if l.startswith("**Excerpt**")), ""
                )
                matches.append({
                    "filename": sec["filename"],
                    "excerpt": excerpt_line.replace("**Excerpt**: ", ""),
                })

        result: dict = {
            "project": project_name,
            "query": query,
            "n_matches": len(matches),
            "matches": matches,
        }

        # Optionally return full document text
        if return_full_content and matches:
            lit_dir = (
                Path(project.literature_dir)
                if project.literature_dir
                else project.literature_path
            )
            full: dict[str, str] = {}
            for m in matches:
                fpath = lit_dir / m["filename"]
                if fpath.exists():
                    content = _read_document(fpath)
                    if content:
                        full[m["filename"]] = content
            result["full_content"] = full

        result["suggestion"] = (
            f"Found {len(matches)} documents matching '{query}'. "
            "Synthesize key findings, compare methodologies, or extract "
            "specific metrics using the excerpts above."
            if matches
            else f"No documents matched '{query}'. Try broader terms or run index_literature to rebuild the index."
        )

        return result
    except Exception as e:
        log.error("search_literature failed: %s", e)
        return _tool_error_to_dict(e)


@mcp.tool()
def add_journal_entry(
    project_name: str,
    entry: str,
    tags: list[str] | None = None,
) -> dict:
    """
    Add a timestamped entry to the project experiment journal.

    The journal is the persistent record of what the researcher has tried,
    found, and concluded — accumulating across all conversations. Entries are
    searchable via search_experiments.

    Use this to log:
      - Key findings from a modelling run
      - Decisions about which gauges to include/exclude
      - Hypotheses being tested
      - Anomalies or data quality issues noticed
      - Conclusions from a literature synthesis

    Parameters
    ----------
    project_name : str
        Project name.
    entry : str
        Journal entry text. Plain language, any length.
    tags : list[str], optional
        Optional tags for easier retrieval, e.g. ["HBV", "gauge 01109000"].

    Returns
    -------
    dict with the new entry and updated journal length.
    """
    try:
        from ai_hydro.session.project import ProjectSession

        project = ProjectSession.load(project_name)
        entry = project.log_entry(entry, tags)
        project.save()

        return {
            "project": project_name,
            "entry": entry,
            "n_total_entries": len(project.journal),
        }
    except Exception as e:
        log.error("add_journal_entry failed: %s", e)
        return _tool_error_to_dict(e)


# ---------------------------------------------------------------------------
# RESEARCHER PROFILE
# ---------------------------------------------------------------------------


@mcp.tool()
def get_researcher_profile() -> dict:
    """
    Return the persistent researcher profile.

    The profile is built up over time from interactions — the agent updates
    it when it learns meaningful things about the researcher (domain, tools,
    preferences, current focus). It is also editable by the researcher
    directly via update_researcher_profile.

    Returns
    -------
    dict with all profile fields and a formatted context_string suitable
    for display or injection into conversation context.
    """
    try:
        from ai_hydro.session.persona import ResearcherProfile

        profile = ResearcherProfile.load()
        result = profile.summary()
        result["context_string"] = profile.to_context_string()
        result["is_blank"] = profile.is_blank()
        return result
    except Exception as e:
        log.error("get_researcher_profile failed: %s", e)
        return _tool_error_to_dict(e)


@mcp.tool()
def update_researcher_profile(
    name: str | None = None,
    institution: str | None = None,
    role: str | None = None,
    domain: str | None = None,
    research_focus: str | None = None,
    expertise: list[str] | None = None,
    preferred_models: list[str] | None = None,
    tools_familiarity: dict | None = None,
    communication_style: str | None = None,
    active_project: str | None = None,
) -> dict:
    """
    Update the researcher profile with new information.

    Can be called by the researcher directly ("remember that I prefer HBV")
    or by the agent when it infers information from the conversation
    ("the researcher just mentioned they're a PhD student at ETH Zurich").

    List fields (expertise, preferred_models) accumulate — new values are
    appended rather than replacing the existing list.
    Dict fields (tools_familiarity) are merged.
    String fields replace the existing value.

    Parameters
    ----------
    name : str, optional
    institution : str, optional
    role : str, optional
        e.g. "PhD student", "postdoc", "hydrological consultant"
    domain : str, optional
        e.g. "hydrology", "geomorphology", "remote sensing"
    research_focus : str, optional
        Current research focus in plain language.
    expertise : list[str], optional
        Specific areas to ADD to the expertise list.
    preferred_models : list[str], optional
        Models to ADD to the preferred list.
    tools_familiarity : dict, optional
        {tool: level} pairs to merge, e.g. {"python": "expert"}.
    communication_style : str, optional
        e.g. "concise technical", "detailed with equations"
    active_project : str, optional
        Currently active project name.

    Returns
    -------
    dict with updated profile and list of changed fields.
    """
    try:
        from ai_hydro.session.persona import ResearcherProfile

        profile = ResearcherProfile.load()

        updates = {k: v for k, v in {
            "name": name,
            "institution": institution,
            "role": role,
            "domain": domain,
            "research_focus": research_focus,
            "expertise": expertise,
            "preferred_models": preferred_models,
            "tools_familiarity": tools_familiarity,
            "communication_style": communication_style,
            "active_project": active_project,
        }.items() if v is not None}

        changed = profile.update(**updates)
        profile.save()

        return {
            "changed_fields": changed,
            "profile": profile.summary(),
            "message": (
                f"Updated: {', '.join(changed)}"
                if changed
                else "No changes — values already match."
            ),
        }
    except Exception as e:
        log.error("update_researcher_profile failed: %s", e)
        return _tool_error_to_dict(e)


@mcp.tool()
def log_researcher_observation(observation: str) -> dict:
    """
    Log an agent observation about the researcher.

    This is the mechanism by which the agent builds up a picture of who the
    researcher is over time — analogous to the memory feature in Claude.ai
    or ChatGPT. Call this when you observe something meaningful and non-obvious
    about the researcher from the conversation.

    Good observations to log:
      - "Researcher confirmed they are a PhD student studying ungauged basins"
      - "Researcher prefers concise responses without derivations"
      - "Researcher mentioned their study region is the Upper Colorado"
      - "Researcher is not familiar with xarray but comfortable with pandas"
      - "Researcher is targeting WRR for publication"

    Do NOT log:
      - Trivial interactions or task confirmations
      - Information already in the profile
      - Temporary preferences ("skip explanations for now")

    Parameters
    ----------
    observation : str
        Plain-language observation about the researcher.

    Returns
    -------
    dict with updated observations list.
    """
    try:
        from ai_hydro.session.persona import ResearcherProfile

        profile = ResearcherProfile.load()
        profile.add_observation(observation)
        profile.save()

        return {
            "observation_logged": observation,
            "n_total_observations": len(profile.observations),
            "recent_observations": profile.observations[-5:],
        }
    except Exception as e:
        log.error("log_researcher_observation failed: %s", e)
        return _tool_error_to_dict(e)
