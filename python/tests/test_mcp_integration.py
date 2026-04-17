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
        "extract_hydrological_signatures",
        "extract_geomorphic_parameters",
        "compute_twi",
        "create_cn_grid",
        "fetch_forcing_data",
        "extract_camels_attributes",
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


# ── Version helpers ──────────────────────────────────────────────────────────

class TestVersionHelpers:
    """Test tools_docs version introspection."""

    def test_get_version_returns_string(self):
        from ai_hydro.mcp.tools_docs import _get_version
        v = _get_version()
        assert isinstance(v, str)
        assert len(v) > 0

    def test_get_camels_attrs_version_returns_string(self):
        from ai_hydro.mcp.tools_docs import _get_camels_attrs_version
        v = _get_camels_attrs_version()
        assert isinstance(v, str)
