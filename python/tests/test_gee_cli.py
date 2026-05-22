from __future__ import annotations

from unittest.mock import patch

from aihydro_gee import cli


def test_status_json_output(capsys):
    with patch("aihydro_gee.cli.status") as mock_status:
        mock_status.return_value = {
            "ok": True,
            "type": "gee_status",
            "authenticated": True,
            "ee_available": True,
            "message": "ok",
            "provenance": {},
        }
        with patch("sys.argv", ["aihydro-gee", "status", "--json"]):
            code = cli.main()
    captured = capsys.readouterr().out
    assert code == 0
    assert '"type": "gee_status"' in captured


def test_preview_chirps_mock(capsys):
    with patch("aihydro_gee.cli.preview_chirps_layer") as mock_preview:
        mock_preview.return_value = {
            "ok": True,
            "type": "gee_tile_layer",
            "name": "CHIRPS precipitation",
            "dataset_id": "UCSB-CHC/CHIRPS/V3/DAILY_SAT",
            "start_date": "2026-01-01",
            "end_date": "2026-01-31",
            "tile_url": "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
            "provenance": {},
            "mock": True,
        }
        with patch(
            "sys.argv",
            [
                "aihydro-gee",
                "preview-chirps",
                "--start-date",
                "2026-01-01",
                "--end-date",
                "2026-01-31",
                "--json",
            ],
        ):
            code = cli.main()
    captured = capsys.readouterr().out
    assert code == 0
    assert '"type": "gee_tile_layer"' in captured


def test_preview_layer_json_output(capsys):
    with patch("aihydro_gee.cli.preview_layer") as mock_preview:
        mock_preview.return_value = {
            "ok": True,
            "type": "gee_tile_layer",
            "name": "Layer",
            "dataset_id": "UCSB-CHC/CHIRPS/V3/DAILY_SAT",
            "band": "precipitation",
            "start_date": "2026-01-01",
            "end_date": "2026-01-31",
            "tile_url_template": "https://tiles/{z}/{x}/{y}",
            "provenance": {},
        }
        with patch(
            "sys.argv",
            [
                "aihydro-gee",
                "preview-layer",
                "--dataset-id",
                "UCSB-CHC/CHIRPS/V3/DAILY_SAT",
                "--band",
                "precipitation",
                "--start-date",
                "2026-01-01",
                "--end-date",
                "2026-01-31",
                "--json",
            ],
        ):
            code = cli.main()
    captured = capsys.readouterr().out
    assert code == 0
    assert '"type": "gee_tile_layer"' in captured


def test_extract_timeseries_json_output(capsys):
    with patch("aihydro_gee.cli.extract_timeseries") as mock_extract:
        mock_extract.return_value = {
            "ok": True,
            "type": "gee_timeseries",
            "rows": [{"date": "2026-01-01", "value": 1.0}],
            "provenance": {},
        }
        with patch(
            "sys.argv",
            [
                "aihydro-gee",
                "extract-timeseries",
                "--dataset-id",
                "UCSB-CHC/CHIRPS/V3/DAILY_SAT",
                "--band",
                "precipitation",
                "--start-date",
                "2026-01-01",
                "--end-date",
                "2026-01-31",
                "--roi-geojson",
                '{"type":"Polygon","coordinates":[[[0,0],[1,0],[1,1],[0,0]]]}',
                "--json",
            ],
        ):
            code = cli.main()
    captured = capsys.readouterr().out
    assert code == 0
    assert '"type": "gee_timeseries"' in captured
