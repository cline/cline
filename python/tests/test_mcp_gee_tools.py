from __future__ import annotations

from pathlib import Path

import pytest
from pydantic import ValidationError

from ai_hydro.mcp import tools_gee


def test_gee_status_schema_accepts_optional_project_id():
    parsed = tools_gee.GeeStatusInput(project_id="my-project")
    assert parsed.project_id == "my-project"


def test_gee_preview_layer_schema_rejects_bad_date():
    with pytest.raises(ValidationError):
        tools_gee.GeePreviewLayerInput(
            start_date="2026/01/01",
            end_date="2026-01-31",
        )


def test_gee_extract_timeseries_schema_rejects_bad_temporal_aggregation():
    with pytest.raises(ValidationError):
        tools_gee.GeeExtractTimeseriesInput(
            dataset_id="UCSB-CHC/CHIRPS/V3/DAILY_SAT",
            band="precipitation",
            start_date="2026-01-01",
            end_date="2026-01-31",
            temporal_aggregation="weekly",  # type: ignore[arg-type]
        )


def test_gee_preview_layer_pushes_map_layer(monkeypatch, tmp_path: Path):
    captured: dict = {}

    monkeypatch.setattr(
        tools_gee,
        "_get_session_geometry",
        lambda _sid: {"type": "Polygon", "coordinates": [[[0, 0], [1, 0], [1, 1], [0, 0]]]},
    )
    monkeypatch.setattr(tools_gee, "_workspace_root", lambda _sid: tmp_path)
    monkeypatch.setattr(
        tools_gee,
        "gee_preview_layer_impl",
        lambda **_kwargs: {
            "ok": True,
            "type": "gee_tile_layer",
            "name": "CHIRPS precipitation",
            "dataset_id": "UCSB-CHC/CHIRPS/V3/DAILY_SAT",
            "band": "precipitation",
            "start_date": "2026-01-01",
            "end_date": "2026-01-31",
            "tile_url_template": "https://tiles/{z}/{x}/{y}",
            "bounds_wgs84": [-100.0, 20.0, -90.0, 30.0],
            "provenance": {},
        },
    )

    def _capture_push_layer(**kwargs):
        captured.update(kwargs)
        return True

    monkeypatch.setattr(tools_gee, "push_layer", _capture_push_layer)

    result = tools_gee.gee_preview_layer(
        session_id="session-a",
        dataset_id="UCSB-CHC/CHIRPS/V3/DAILY_SAT",
        band="precipitation",
        start_date="2026-01-01",
        end_date="2026-01-31",
        roi="current_map_basin",
        reducer="sum",
    )

    assert result["ok"] is True
    assert captured["layer_type"] == "gee_tile"
    assert "gee_tile_url_template" in captured["metadata"]
    assert Path(result["provenance_path"]).exists()


def test_gee_preview_layer_missing_basin_returns_clear_error():
    result = tools_gee.gee_preview_layer(
        session_id=None,
        dataset_id="UCSB-CHC/CHIRPS/V3/DAILY_SAT",
        band="precipitation",
        start_date="2026-01-01",
        end_date="2026-01-31",
        roi="current_map_basin",
        reducer="sum",
    )
    assert result.get("error") is True
    assert "No active basin geometry found. Draw or load a basin in the map first." in result.get("message", "")


def test_gee_extract_timeseries_writes_csv(monkeypatch, tmp_path: Path):
    monkeypatch.setattr(
        tools_gee,
        "_get_session_geometry",
        lambda _sid: {"type": "Polygon", "coordinates": [[[0, 0], [1, 0], [1, 1], [0, 0]]]},
    )
    monkeypatch.setattr(tools_gee, "_workspace_root", lambda _sid: tmp_path)
    monkeypatch.setattr(
        tools_gee,
        "gee_extract_timeseries_impl",
        lambda **_kwargs: {
            "ok": True,
            "type": "gee_timeseries",
            "rows": [{"date": "2026-01-01", "value": 1.2}, {"date": "2026-01-02", "value": 2.3}],
            "provenance": {},
        },
    )

    result = tools_gee.gee_extract_timeseries(
        session_id="session-a",
        dataset_id="UCSB-CHC/CHIRPS/V3/DAILY_SAT",
        band="precipitation",
        start_date="2026-01-01",
        end_date="2026-01-31",
        roi="current_map_basin",
        spatial_reducer="mean",
        temporal_aggregation="daily",
        scale_m=5000.0,
    )

    assert result["ok"] is True
    assert result["row_count"] == 2
    assert Path(result["csv_path"]).exists()
    assert Path(result["provenance_path"]).exists()
