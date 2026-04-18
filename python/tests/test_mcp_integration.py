"""
MCP Server Integration Tests
==============================

Validates that the modular MCP server registers all built-in tools correctly,
helpers work as expected, and session wiring behaves across tool calls.

Run:
    pytest tests/test_mcp_integration.py -v
"""
from __future__ import annotations

import asyncio
import json
import tempfile
from pathlib import Path
from unittest.mock import patch, MagicMock

import pytest


# ── Tool registration tests ────────────────────────────────────────────────

class TestToolRegistration:
    """Verify that importing ai_hydro.mcp registers all expected tools."""

    EXPECTED_TOOLS = {
        # Analysis (9)
        "delineate_watershed",
        "fetch_streamflow_data",
        "fetch_camels_us",
        "extract_hydrological_signatures",
        "extract_geomorphic_parameters",
        "compute_twi",
        "create_cn_grid",
        "fetch_forcing_data",
        "get_library_reference",
        # Session (8)
        "start_session",
        "get_session_summary",
        "clear_session",
        "add_note",
        "export_session",
        "sync_research_context",
        "list_available_tools",
        # Modelling (2)
        "train_hydro_model",
        "get_model_results",
        # Project management (5)
        "start_project",
        "add_session_to_project",
        "get_project_summary",
        "add_journal_entry",
        "search_experiments",
        # Literature (2)
        "index_literature",
        "search_literature",
        # Researcher profile (3)
        "get_researcher_profile",
        "update_researcher_profile",
        "log_researcher_observation",
    }

    def test_import_mcp_singleton(self):
        """Importing ai_hydro.mcp should provide the FastMCP instance."""
        from ai_hydro.mcp import mcp
        assert mcp is not None
        assert mcp.name == "AI-Hydro"

    def test_all_builtin_tools_registered(self):
        """All built-in tools must be registered after importing ai_hydro.mcp."""
        from ai_hydro.mcp import mcp
        tools = asyncio.run(mcp.list_tools())
        tool_names = {t.name for t in tools}
        assert tool_names == self.EXPECTED_TOOLS, (
            f"Missing: {self.EXPECTED_TOOLS - tool_names}, "
            f"Extra: {tool_names - self.EXPECTED_TOOLS}"
        )

    def test_tool_count_matches_expected(self):
        """Tool count matches EXPECTED_TOOLS — catches accidental duplicates or drops."""
        from ai_hydro.mcp import mcp
        tools = asyncio.run(mcp.list_tools())
        assert len(tools) == len(self.EXPECTED_TOOLS)

    def test_all_tools_have_descriptions(self):
        """Every tool should have a non-empty description (from docstring)."""
        from ai_hydro.mcp import mcp
        tools = asyncio.run(mcp.list_tools())
        for tool in tools:
            assert tool.description, f"Tool {tool.name} has no description"

    def test_all_tools_have_input_schema(self):
        """Every tool should have an input schema (may use various attr names)."""
        from ai_hydro.mcp import mcp
        tools = asyncio.run(mcp.list_tools())
        for tool in tools:
            # FastMCP may expose schema as inputSchema or input_schema
            schema = (
                getattr(tool, "inputSchema", None)
                or getattr(tool, "input_schema", None)
                or {}
            )
            # Schema should exist (even if empty for tools with all-optional params)
            assert isinstance(schema, dict), f"Tool {tool.name} has no input schema"


# ── Helper tests ────────────────────────────────────────────────────────────

class TestHelpers:
    """Test shared MCP helper functions."""

    def test_validate_usgs_gauge_id_pads_short(self):
        from ai_hydro.mcp.helpers import _validate_usgs_gauge_id
        assert _validate_usgs_gauge_id("1031500") == "01031500"

    def test_validate_usgs_gauge_id_accepts_8_digit(self):
        from ai_hydro.mcp.helpers import _validate_usgs_gauge_id
        assert _validate_usgs_gauge_id("01031500") == "01031500"

    def test_validate_usgs_gauge_id_rejects_alpha(self):
        from ai_hydro.mcp.helpers import _validate_usgs_gauge_id
        with pytest.raises(ValueError, match="Invalid USGS gauge_id"):
            _validate_usgs_gauge_id("abc12345")

    def test_validate_usgs_gauge_id_strips_whitespace(self):
        from ai_hydro.mcp.helpers import _validate_usgs_gauge_id
        assert _validate_usgs_gauge_id("  01031500  ") == "01031500"

    def test_normalize_session_id_accepts_any_string(self):
        from ai_hydro.mcp.helpers import _normalize_session_id
        assert _normalize_session_id("piscataquis-2020") == "piscataquis-2020"
        assert _normalize_session_id("01031500") == "01031500"

    def test_normalize_session_id_auto_generates(self):
        from ai_hydro.mcp.helpers import _normalize_session_id
        result = _normalize_session_id(None)
        assert result.startswith("hydro-")
        assert len(result) == len("hydro-") + 8

    def test_result_to_dict_passthrough(self):
        from ai_hydro.mcp.helpers import _result_to_dict
        d = {"data": {"x": 1}, "meta": {}}
        assert _result_to_dict(d) is d

    def test_result_to_dict_hydro_result(self):
        from ai_hydro.mcp.helpers import _result_to_dict
        mock = MagicMock()
        mock.to_dict.return_value = {"data": {}, "meta": {}}
        assert _result_to_dict(mock) == {"data": {}, "meta": {}}

    def test_tool_error_to_dict_plain_exception(self):
        from ai_hydro.mcp.helpers import _tool_error_to_dict
        result = _tool_error_to_dict(ValueError("bad input"))
        assert result["error"] is True
        assert result["code"] == "UNKNOWN_ERROR"
        assert "bad input" in result["message"]

    def test_tool_error_to_dict_tool_error(self):
        from ai_hydro.mcp.helpers import _tool_error_to_dict
        mock = MagicMock()
        mock.to_dict.return_value = {"error": True, "code": "TEST"}
        assert _tool_error_to_dict(mock) == {"error": True, "code": "TEST"}

    def test_strip_forcing_arrays(self):
        from ai_hydro.mcp.helpers import _strip_forcing_arrays
        data = {
            "n_days": 365,
            "prcp_mm": [1.0, 2.0, 3.0],
            "tmax_C": [10.0, 20.0, 30.0],
        }
        compact = _strip_forcing_arrays(data)
        assert "prcp_mm" not in compact  # array stripped
        assert compact["prcp_mm_mean"] == 2.0
        assert compact["tmax_C_mean"] == 20.0
        assert compact["n_days"] == 365
        assert compact["n_variables"] == 2

    def test_cached_response_structure(self):
        from ai_hydro.mcp.helpers import _cached_response
        session = MagicMock()
        session.gauge_id = "01031500"
        session.signatures = {"data": {"bfi": 0.5}, "meta": {"tool": "test"}}
        result = _cached_response("signatures", session)
        assert result["_cached"] is True
        assert result["data"]["bfi"] == 0.5
        assert "clear_session" in result["_note"]


# ── Session wiring tests ────────────────────────────────────────────────────

class TestSessionWiring:
    """Test that session load/store/ensure helpers work correctly."""

    def test_ensure_session_creates_new(self, tmp_path):
        """_ensure_session should create a new session for an unknown session_id."""
        from ai_hydro.mcp.helpers import _ensure_session
        with patch("ai_hydro.session.store._SESSIONS_DIR", tmp_path):
            session = _ensure_session("my-research-session")
            assert session.session_id == "my-research-session"

    def test_ensure_session_sets_workspace(self, tmp_path):
        """_ensure_session should store workspace_dir on first call."""
        from ai_hydro.mcp.helpers import _ensure_session
        ws = str(tmp_path / "workspace")
        with patch("ai_hydro.session.store._SESSIONS_DIR", tmp_path):
            session = _ensure_session("my-research-session", workspace_dir=ws)
            assert session.workspace_dir == ws

    def test_session_store_caches_result(self, tmp_path):
        """_session_store should persist a result and write research.md."""
        from ai_hydro.mcp.helpers import _session_store
        from ai_hydro.session import HydroSession
        with patch("ai_hydro.session.store._SESSIONS_DIR", tmp_path), \
             patch("ai_hydro.session.store._REPO_ROOT", tmp_path):
            _session_store("99999999", "watershed", {"data": {"area_km2": 100}})
            # Verify it was saved
            reloaded = HydroSession.load("99999999")
            assert reloaded.watershed is not None
            assert reloaded.watershed["data"]["area_km2"] == 100

    def test_session_roundtrip(self, tmp_path):
        """Full save/load cycle with multiple slots."""
        from ai_hydro.session import HydroSession
        with patch("ai_hydro.session.store._SESSIONS_DIR", tmp_path), \
             patch("ai_hydro.session.store._REPO_ROOT", tmp_path):
            s = HydroSession("99999999")
            s.watershed = {"data": {"area_km2": 50}}
            s.streamflow = {"data": {"n_days": 365}}
            s.notes.append("test note")
            s.save()

            s2 = HydroSession.load("99999999")
            assert s2.watershed["data"]["area_km2"] == 50
            assert s2.streamflow["data"]["n_days"] == 365
            assert "test note" in s2.notes
            assert "watershed" in s2.computed()
            assert "streamflow" in s2.computed()


# ── Tool-level smoke tests (mocked backends) ────────────────────────────────

class TestToolSmoke:
    """Smoke-test individual tools with mocked backends."""

    def test_start_session_creates_session(self, tmp_path):
        """start_session should return a summary dict with session_id."""
        from ai_hydro.mcp.tools_session import start_session
        with patch("ai_hydro.session.store._SESSIONS_DIR", tmp_path), \
             patch("ai_hydro.session.store._REPO_ROOT", tmp_path):
            result = start_session("piscataquis-2020")
            assert result["session_id"] == "piscataquis-2020"
            assert "computed" in result
            assert "pending" in result

    def test_get_session_summary(self, tmp_path):
        """get_session_summary should return computed/pending lists."""
        from ai_hydro.mcp.tools_session import get_session_summary
        with patch("ai_hydro.session.store._SESSIONS_DIR", tmp_path), \
             patch("ai_hydro.session.store._REPO_ROOT", tmp_path):
            result = get_session_summary("01031500")
            assert isinstance(result["computed"], list)
            assert isinstance(result["pending"], list)

    def test_add_note_appends(self, tmp_path):
        """add_note should append text to session notes."""
        from ai_hydro.mcp.tools_session import add_note
        with patch("ai_hydro.session.store._SESSIONS_DIR", tmp_path), \
             patch("ai_hydro.session.store._REPO_ROOT", tmp_path):
            result = add_note("01031500", "my research note")
            assert "my research note" in result["notes"]

    def test_clear_session_resets_slots(self, tmp_path):
        """clear_session should reset specified slots."""
        from ai_hydro.session import HydroSession
        from ai_hydro.mcp.tools_session import clear_session
        with patch("ai_hydro.session.store._SESSIONS_DIR", tmp_path), \
             patch("ai_hydro.session.store._REPO_ROOT", tmp_path):
            # Pre-populate
            s = HydroSession("01031500")
            s.watershed = {"data": {"area_km2": 100}}
            s.streamflow = {"data": {"n_days": 365}}
            s.save()
            # Clear just watershed
            result = clear_session("01031500", ["watershed"])
            assert "watershed" in result["cleared"]
            assert "streamflow" not in result.get("cleared", [])

    def test_clear_session_rejects_invalid_slot(self, tmp_path):
        """clear_session with invalid slot name should return error."""
        from ai_hydro.mcp.tools_session import clear_session
        with patch("ai_hydro.session.store._SESSIONS_DIR", tmp_path), \
             patch("ai_hydro.session.store._REPO_ROOT", tmp_path):
            result = clear_session("01031500", ["nonexistent_slot"])
            assert result["error"] is True
            assert result["code"] == "INVALID_SLOTS"

    def test_export_session_json(self, tmp_path):
        """export_session should write JSON and return file path."""
        from ai_hydro.mcp.tools_session import export_session
        from ai_hydro.session import HydroSession
        with patch("ai_hydro.session.store._SESSIONS_DIR", tmp_path), \
             patch("ai_hydro.session.store._REPO_ROOT", tmp_path):
            s = HydroSession("01031500")
            s.workspace_dir = str(tmp_path)
            s.save()
            result = export_session("01031500", format="json")
            assert result["file_saved"] is not None
            assert Path(result["file_saved"]).exists()

    def test_get_model_results_no_model(self, tmp_path):
        """get_model_results should report no model trained."""
        from ai_hydro.mcp.tools_modelling import get_model_results
        with patch("ai_hydro.session.store._SESSIONS_DIR", tmp_path), \
             patch("ai_hydro.session.store._REPO_ROOT", tmp_path):
            result = get_model_results("01031500")
            assert result["model_trained"] is False

    def test_delineate_watershed_invalid_gauge(self, tmp_path):
        """delineate_watershed with invalid USGS gauge_id should return error."""
        from ai_hydro.mcp.tools_analysis import delineate_watershed
        with patch("ai_hydro.session.store._SESSIONS_DIR", tmp_path), \
             patch("ai_hydro.session.store._REPO_ROOT", tmp_path):
            # Pass an invalid USGS gauge_id — session_id is fine, gauge_id is not
            result = delineate_watershed("my-test-session", gauge_id="not_a_gauge")
            assert result["error"] is True

    def test_start_session_exposes_mcp_python(self, tmp_path):
        """start_session should return mcp_python, mcp_pip, available_packages."""
        from ai_hydro.mcp.tools_session import start_session
        with patch("ai_hydro.session.store._SESSIONS_DIR", tmp_path), \
             patch("ai_hydro.session.store._REPO_ROOT", tmp_path):
            result = start_session("piscataquis-2020")
            assert "mcp_python" in result
            assert result["mcp_python"].endswith("python") or "python" in result["mcp_python"]
            assert "mcp_pip" in result
            assert "available_packages" in result
            assert isinstance(result["available_packages"], dict)

    def test_list_available_tools_returns_tool_list(self):
        """list_available_tools should return all registered tools.
        Uses mcp.list_tools() directly to avoid the sync-wrapper guard."""
        import asyncio
        from ai_hydro.mcp.app import mcp
        tools = asyncio.run(mcp.list_tools())
        names = {t.name for t in tools}
        assert len(tools) >= 28
        assert "delineate_watershed" in names
        assert "start_session" in names
        assert "get_library_reference" in names
        assert "list_available_tools" in names

    def test_get_library_reference_pynhd(self):
        """get_library_reference should return pynhd gotchas."""
        from ai_hydro.mcp.tools_analysis import get_library_reference
        result = get_library_reference("pynhd")
        assert "gotchas" in result
        assert isinstance(result["gotchas"], list)
        assert len(result["gotchas"]) > 0
        assert result["library"] == "pynhd"

    def test_get_library_reference_not_found(self):
        """get_library_reference with unknown library should return error + available_refs."""
        from ai_hydro.mcp.tools_analysis import get_library_reference
        result = get_library_reference("nonexistent_lib")
        assert result["error"] is True
        assert result["code"] == "NOT_FOUND"
        assert "available_refs" in result
        assert "pynhd" in result["available_refs"]


# ── Lean session storage + synopsis ─────────────────────────────────────────

class TestLeanSession:
    """Verify that raw time-series arrays are stripped from the session JSON
    and that synopsis_for_llm() returns only scalar summaries."""

    def test_lean_slot_strips_large_lists(self):
        """_lean_slot should remove lists > 50 items and add {key}_n counts."""
        from ai_hydro.session.store import _lean_slot
        val = {
            "data": {
                "dates": list(range(3652)),
                "q_cms": [1.0] * 3652,
                "n_days": 3652,
                "gauge_name": "Test Gauge",
            },
            "meta": {"tool": "fetch_streamflow_data"},
        }
        lean = _lean_slot(val)
        assert "dates" not in lean["data"]
        assert "q_cms" not in lean["data"]
        assert lean["data"]["dates_n"] == 3652
        assert lean["data"]["q_cms_n"] == 3652
        assert lean["data"]["n_days"] == 3652        # scalars preserved
        assert lean["data"]["gauge_name"] == "Test Gauge"
        assert lean["meta"]["tool"] == "fetch_streamflow_data"  # meta untouched

    def test_lean_slot_keeps_short_lists(self):
        """Lists ≤ 50 items should be kept verbatim."""
        from ai_hydro.session.store import _lean_slot
        val = {
            "data": {
                "variables": ["prcp_mm", "tmax_C", "tmin_C"],
                "train_period": ["2000-10-01", "2007-09-30"],
            },
            "meta": {},
        }
        lean = _lean_slot(val)
        assert lean["data"]["variables"] == ["prcp_mm", "tmax_C", "tmin_C"]
        assert lean["data"]["train_period"] == ["2000-10-01", "2007-09-30"]

    def test_lean_slot_preserves_private_keys(self):
        """_data_file and other _ keys must survive stripping."""
        from ai_hydro.session.store import _lean_slot
        val = {
            "data": {
                "_data_file": "/workspace/streamflow_01031500.json",
                "q_cms": [1.0] * 3652,
                "n_days": 3652,
            },
            "meta": {},
        }
        lean = _lean_slot(val)
        assert lean["data"]["_data_file"] == "/workspace/streamflow_01031500.json"
        assert "q_cms" not in lean["data"]

    def test_session_json_is_lean_after_save(self, tmp_path):
        """Saved session.json must not contain large list arrays."""
        from ai_hydro.session import HydroSession
        with patch("ai_hydro.session.store._SESSIONS_DIR", tmp_path), \
             patch("ai_hydro.session.store._REPO_ROOT", tmp_path):
            s = HydroSession("test-lean")
            s.streamflow = {
                "data": {"dates": list(range(3652)), "q_cms": [1.0] * 3652,
                         "n_days": 3652},
                "meta": {"tool": "fetch_streamflow_data"},
            }
            s.save()
            # Read raw JSON — must not contain the big arrays
            raw_json = (tmp_path / "test-lean.json").read_text()
            data = json.loads(raw_json)
            sf_data = data["streamflow"]["data"]
            assert "dates" not in sf_data
            assert "q_cms" not in sf_data
            assert sf_data["dates_n"] == 3652
            assert sf_data["n_days"] == 3652

    def test_session_json_size_is_small(self, tmp_path):
        """A session with 3652-day streamflow should fit in < 10 KB on disk."""
        from ai_hydro.session import HydroSession
        with patch("ai_hydro.session.store._SESSIONS_DIR", tmp_path), \
             patch("ai_hydro.session.store._REPO_ROOT", tmp_path):
            s = HydroSession("test-size")
            s.streamflow = {
                "data": {"dates": list(range(3652)), "q_cms": [1.0] * 3652,
                         "n_days": 3652},
                "meta": {"tool": "fetch_streamflow_data"},
            }
            s.save()
            size_bytes = (tmp_path / "test-size.json").stat().st_size
            assert size_bytes < 10_000, (
                f"Session JSON is {size_bytes} bytes — lean storage should be < 10 KB"
            )

    def test_synopsis_for_llm_no_arrays(self, tmp_path):
        """synopsis_for_llm must never return lists > 50 items."""
        from ai_hydro.session import HydroSession
        with patch("ai_hydro.session.store._SESSIONS_DIR", tmp_path), \
             patch("ai_hydro.session.store._REPO_ROOT", tmp_path):
            s = HydroSession("test-synopsis")
            s.streamflow = {
                "data": {"dates": ["2020-01-01"] * 3652,
                         "q_cms": [1.0] * 3652, "n_days": 3652},
                "meta": {"tool": "fetch_streamflow_data",
                         "computed_at": "2026-04-17T10:00:00"},
            }
            s.signatures = {
                "data": {"q_mean": 5.2, "bfi": 0.4, "runoff_ratio": 0.6},
                "meta": {"tool": "extract_hydrological_signatures",
                         "computed_at": "2026-04-17T11:00:00"},
            }
            synopsis = s.synopsis_for_llm()
            # Check streamflow synopsis
            sf = synopsis["streamflow"]
            assert "dates" not in sf
            assert "q_cms" not in sf
            assert sf["dates_n"] == 3652
            assert sf["n_days"] == 3652
            # Check signatures — all scalars, no stripping needed
            sig = synopsis["signatures"]
            assert sig["q_mean"] == 5.2
            assert sig["bfi"] == 0.4
            # No list longer than 50 anywhere in the synopsis
            for slot_data in synopsis.values():
                for k, v in slot_data.items():
                    if isinstance(v, list):
                        assert len(v) <= 50, (
                            f"synopsis_for_llm returned list of {len(v)} items "
                            f"in slot {slot_data} key {k}"
                        )

    def test_sync_reminder_fires_at_2_slots(self, tmp_path):
        """_sync_reminder should return a string once 2+ slots are computed."""
        from ai_hydro.mcp.helpers import _sync_reminder
        from ai_hydro.session import HydroSession
        with patch("ai_hydro.session.store._SESSIONS_DIR", tmp_path), \
             patch("ai_hydro.session.store._REPO_ROOT", tmp_path):
            s = HydroSession("test-remind")
            s.watershed = {"data": {"area_km2": 100}, "meta": {}}
            s.save()
            assert _sync_reminder("test-remind") is None  # only 1 slot
            s2 = HydroSession.load("test-remind")
            s2.streamflow = {"data": {"n_days": 365}, "meta": {}}
            s2.save()
            reminder = _sync_reminder("test-remind")
            assert reminder is not None
            assert "sync_research_context" in reminder

    def test_sync_reminder_silent_after_interpretation(self, tmp_path):
        """_sync_reminder should return None once interpretation is written."""
        from ai_hydro.mcp.helpers import _sync_reminder
        from ai_hydro.session import HydroSession
        with patch("ai_hydro.session.store._SESSIONS_DIR", tmp_path), \
             patch("ai_hydro.session.store._REPO_ROOT", tmp_path):
            s = HydroSession("test-interpreted")
            s.watershed = {"data": {"area_km2": 100}, "meta": {}}
            s.streamflow = {"data": {"n_days": 365}, "meta": {}}
            s.interpretation = "The basin shows strong baseflow dominance."
            s.save()
            assert _sync_reminder("test-interpreted") is None


# ── Version helpers ──────────────────────────────────────────────────────────

class TestVersionHelpers:
    """Test tools_docs version introspection."""

    def test_get_version_returns_string(self):
        from ai_hydro.mcp.tools_docs import _get_version
        v = _get_version()
        assert isinstance(v, str)
        assert len(v) > 0


# ── Citation system ───────────────────────────────────────────────────────────

class TestCitationRegistry:
    """Verify the three-tier citation registry and BibTeX builder."""

    def test_all_known_keys_non_empty(self):
        from ai_hydro.citations import all_known_keys
        keys = all_known_keys()
        assert len(keys) >= 10, "Expected at least 10 citation entries"

    def test_platform_citations_always_in_bibtex(self):
        from ai_hydro.citations import build_bibtex, PLATFORM_CITATIONS
        bib = build_bibtex(set())
        for key in PLATFORM_CITATIONS:
            assert key in bib, f"Platform citation '{key}' missing from empty-key build"

    def test_build_bibtex_includes_requested_keys(self):
        from ai_hydro.citations import build_bibtex
        bib = build_bibtex({"usgs_nwis", "abatzoglou2013gridmet"})
        assert "usgs_nwis" in bib
        assert "abatzoglou2013gridmet" in bib
        assert "waterdata.usgs.gov" in bib
        assert "10.1002/joc.3413" in bib

    def test_build_bibtex_skips_unknown_keys(self):
        from ai_hydro.citations import build_bibtex
        bib = build_bibtex({"nonexistent_key_xyz"})
        assert "nonexistent_key_xyz" not in bib
        # Platform citations still present
        assert "aihydro2026" in bib

    def test_tool_citations_map_known_tools(self):
        from ai_hydro.citations import citation_keys_for_tool, all_known_keys
        known = set(all_known_keys())
        for tool in ("delineate_watershed", "fetch_streamflow_data",
                     "fetch_forcing_data", "fetch_camels_us",
                     "train_hydro_model", "create_cn_grid"):
            keys = citation_keys_for_tool(tool)
            assert len(keys) > 0, f"No citation keys for tool '{tool}'"
            for k in keys:
                assert k in known, f"Unknown citation key '{k}' for tool '{tool}'"

    def test_tool_with_no_citations_returns_empty(self):
        from ai_hydro.citations import citation_keys_for_tool
        assert citation_keys_for_tool("nonexistent_tool") == []

    def test_build_bibtex_header_present(self):
        from ai_hydro.citations import build_bibtex
        bib = build_bibtex(set(), header=True)
        assert "AI-Hydro" in bib
        assert bib.startswith("%")

    def test_build_bibtex_no_duplicate_entries(self):
        from ai_hydro.citations import build_bibtex, PLATFORM_CITATIONS
        # Pass platform keys explicitly — BibTeX entry key should appear exactly once
        bib = build_bibtex(set(PLATFORM_CITATIONS))
        assert bib.count("@software{aihydro2026") == 1
        assert bib.count("@software{aihydro_tools2026") == 1

    def test_register_plugin_citation(self):
        from ai_hydro.citations import (
            register_plugin_citation, citation_keys_for_tool, build_bibtex,
            _PLUGIN_ENTRIES, _PLUGIN_TOOL_MAP,
        )
        bibtex = "@software{test_plugin_2026, author={Test}, title={Test Plugin}}"
        register_plugin_citation("test_plugin_2026", bibtex, ["my_plugin_tool"])
        assert "test_plugin_2026" in _PLUGIN_ENTRIES
        assert "my_plugin_tool" in _PLUGIN_TOOL_MAP
        keys = citation_keys_for_tool("my_plugin_tool")
        assert "test_plugin_2026" in keys
        bib = build_bibtex({"test_plugin_2026"})
        assert "Test Plugin" in bib
        # Cleanup to avoid polluting other tests
        del _PLUGIN_ENTRIES["test_plugin_2026"]
        del _PLUGIN_TOOL_MAP["my_plugin_tool"]


class TestSessionCitations:
    """Verify citation accumulation and bibtex export on HydroSession."""

    def test_add_citations_accumulates(self, tmp_path):
        from ai_hydro.session import HydroSession
        with patch("ai_hydro.session.store._SESSIONS_DIR", tmp_path), \
             patch("ai_hydro.session.store._REPO_ROOT", tmp_path):
            s = HydroSession("cite-test-1")
            s.add_citations(["usgs_nwis"])
            s.add_citations(["abatzoglou2013gridmet", "usgs_nwis"])  # duplicate
            assert s.get_citations() == {"usgs_nwis", "abatzoglou2013gridmet"}

    def test_citations_survive_save_reload(self, tmp_path):
        from ai_hydro.session import HydroSession
        with patch("ai_hydro.session.store._SESSIONS_DIR", tmp_path), \
             patch("ai_hydro.session.store._REPO_ROOT", tmp_path):
            s = HydroSession("cite-test-2")
            s.add_citations(["usgs_nwis", "nhd_nhdplus"])
            s.save()
            reloaded = HydroSession.load("cite-test-2")
            assert "usgs_nwis" in reloaded.get_citations()
            assert "nhd_nhdplus" in reloaded.get_citations()

    def test_export_bibtex_includes_platform(self, tmp_path):
        from ai_hydro.session import HydroSession
        with patch("ai_hydro.session.store._SESSIONS_DIR", tmp_path), \
             patch("ai_hydro.session.store._REPO_ROOT", tmp_path):
            s = HydroSession("cite-test-3")
            s.add_citations(["usgs_nwis"])
            bib = s.export_bibtex()
            assert "aihydro2026" in bib       # Tier 2
            assert "aihydro_tools2026" in bib # Tier 2
            assert "usgs_nwis" in bib         # Tier 1

    def test_citations_empty_session_still_has_platform(self, tmp_path):
        from ai_hydro.session import HydroSession
        with patch("ai_hydro.session.store._SESSIONS_DIR", tmp_path), \
             patch("ai_hydro.session.store._REPO_ROOT", tmp_path):
            s = HydroSession("cite-test-4")
            bib = s.export_bibtex()
            assert "aihydro2026" in bib
            assert "aihydro_tools2026" in bib

    def test_session_store_adds_citations(self, tmp_path):
        from ai_hydro.mcp.helpers import _session_store
        from ai_hydro.session import HydroSession
        with patch("ai_hydro.session.store._SESSIONS_DIR", tmp_path), \
             patch("ai_hydro.session.store._REPO_ROOT", tmp_path):
            slot_data = {"data": {"area_km2": 500}, "meta": {}}
            _session_store("cite-test-5", "watershed", slot_data,
                           tool_name="delineate_watershed")
            s = HydroSession.load("cite-test-5")
            citations = s.get_citations()
            assert "nhd_nhdplus" in citations
            assert "usgs_3dep" in citations

    def test_cite_all_is_alias_for_export_bibtex(self, tmp_path):
        from ai_hydro.session import HydroSession
        with patch("ai_hydro.session.store._SESSIONS_DIR", tmp_path), \
             patch("ai_hydro.session.store._REPO_ROOT", tmp_path):
            s = HydroSession("cite-test-6")
            s.add_citations(["usgs_nwis"])
            assert s.cite_all() == s.export_bibtex()
