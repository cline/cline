"""Tests for map orchestration MCP tools and ROI resolution."""
from __future__ import annotations

import json
from pathlib import Path

import pytest


def test_write_map_command_creates_json(tmp_path, monkeypatch):
    from ai_hydro.mcp import map_commands

    cmd_dir = tmp_path / "map_commands"
    monkeypatch.setattr(map_commands, "_MAP_COMMANDS_DIR", cmd_dir)

    ok = map_commands.push_set_roi(
        geojson={"type": "FeatureCollection", "features": []},
        name="Test ROI",
    )
    assert ok is True
    files = list(cmd_dir.glob("*.json"))
    assert len(files) == 1
    payload = json.loads(files[0].read_text())
    assert payload["type"] == "set_roi"
    assert payload["roi"]["name"] == "Test ROI"


def test_resolve_active_roi_priority_workspace(tmp_path, monkeypatch):
    from unittest.mock import patch

    from ai_hydro.mcp.helpers import _resolve_active_roi_geojson
    from ai_hydro.session import HydroSession

    monkeypatch.setattr(Path, "home", lambda: tmp_path)

    ws = tmp_path / "workspace"
    ws.mkdir()
    roi_dir = ws / "roi"
    roi_dir.mkdir()
    rel = "roi/user_basin.geojson"
    (ws / rel).write_text(
        json.dumps({"type": "Polygon", "coordinates": [[[0, 0], [1, 0], [1, 1], [0, 0]]]}),
        encoding="utf-8",
    )
    (roi_dir / "active.json").write_text(
        json.dumps({"path": rel, "name": "User basin"}),
        encoding="utf-8",
    )

    aihydro = tmp_path / ".aihydro"
    aihydro.mkdir()
    (aihydro / "map_session.json").write_text(
        json.dumps(
            {
                "activeRoi": {
                    "geojson": json.dumps({"type": "Point", "coordinates": [9, 9]}),
                    "name": "Map session ROI",
                }
            }
        ),
        encoding="utf-8",
    )

    session_id = "test-map-roi-priority"
    with patch("ai_hydro.session.store._SESSIONS_DIR", tmp_path / "sessions"), \
         patch("ai_hydro.session.store._REPO_ROOT", tmp_path):
        (tmp_path / "sessions").mkdir(exist_ok=True)
        session = HydroSession(session_id)
        session.workspace_dir = str(ws)
        session.save()
        geojson, source = _resolve_active_roi_geojson(session_id)
    assert source == "workspace_roi"
    assert geojson["type"] == "Polygon"


def test_map_get_state_reads_session_file(tmp_path, monkeypatch):
    from ai_hydro.mcp import tools_map

    session_file = tmp_path / "map_session.json"
    session_file.write_text(
        json.dumps(
            {
                "activeRoi": {
                    "id": "r1",
                    "name": "Basin A",
                    "source": "agent",
                    "geojson": "{}",
                    "areaHa": 500,
                },
                "workspaceRoot": str(tmp_path),
            }
        ),
        encoding="utf-8",
    )
    monkeypatch.setattr(tools_map, "_MAP_SESSION_FILE", session_file)

    state = tools_map.map_get_state(session_id=None, event_limit=5)
    assert state["active_roi"]["name"] == "Basin A"
    assert state["active_roi"]["area_ha"] == 500


def test_push_update_layer_command(tmp_path, monkeypatch):
    from ai_hydro.mcp import map_commands

    cmd_dir = tmp_path / "map_commands"
    monkeypatch.setattr(map_commands, "_MAP_COMMANDS_DIR", cmd_dir)

    ok = map_commands.push_update_layer(
        layer_id="file_vectors_basin",
        style={"fillColor": "#FF5733", "fillOpacity": 0.5},
        metadata={"display_name": "Styled basin"},
    )
    assert ok is True
    payload = json.loads(list(cmd_dir.glob("*.json"))[0].read_text())
    assert payload["type"] == "update_layer"
    assert payload["layer_id"] == "file_vectors_basin"
    assert payload["style"]["fillColor"] == "#FF5733"


def test_map_get_state_includes_layer_catalog(tmp_path, monkeypatch):
    from ai_hydro.mcp import map_layer_catalog, tools_map

    monkeypatch.setattr(tools_map, "_MAP_SESSION_FILE", tmp_path / "map_session.json")
    (tmp_path / "map_session.json").write_text("{}", encoding="utf-8")
    catalog_file = tmp_path / "map_layer_catalog.json"
    catalog_file.write_text(
        json.dumps(
            {
                "layer_order": ["l1"],
                "layers": [
                    {
                        "id": "l1",
                        "name": "Test",
                        "layer_type": "polygon",
                        "visible": True,
                        "symbology_mode": "basic",
                        "numeric_attributes": [],
                        "feature_count": 1,
                    }
                ],
            }
        ),
        encoding="utf-8",
    )
    monkeypatch.setattr(map_layer_catalog, "MAP_LAYER_CATALOG_FILE", catalog_file)

    state = tools_map.map_get_state()
    assert state["layers"][0]["id"] == "l1"


def test_compute_graduated_metadata():
    from ai_hydro.mcp.map_layer_catalog import compute_graduated_metadata

    geojson = {
        "type": "FeatureCollection",
        "features": [
            {"properties": {"twi": 1.0}},
            {"properties": {"twi": 5.0}},
            {"properties": {"twi": 10.0}},
        ],
    }
    meta = compute_graduated_metadata(geojson, attribute="twi", num_classes=3)
    assert meta["graduated_attr"] == "twi"
    breaks = json.loads(meta["graduated_breaks"])
    assert len(breaks) >= 2
    colors = json.loads(meta["graduated_colors"])
    assert len(colors) >= 2
