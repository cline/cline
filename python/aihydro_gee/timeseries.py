from __future__ import annotations

from datetime import datetime
from typing import Any

import pandas as pd

from .auth import _import_ee


def _aggregate_rows(rows: list[dict[str, Any]], temporal_aggregation: str) -> list[dict[str, Any]]:
    if temporal_aggregation == "daily":
        return rows
    if not rows:
        return rows

    df = pd.DataFrame(rows)
    df["date"] = pd.to_datetime(df["date"], errors="coerce")
    df["value"] = pd.to_numeric(df["value"], errors="coerce")
    df = df.dropna(subset=["date", "value"])
    if df.empty:
        return []

    if temporal_aggregation == "monthly":
        grouped = df.groupby(df["date"].dt.to_period("M"))["value"].mean().reset_index()
        grouped["date"] = grouped["date"].dt.strftime("%Y-%m")
    elif temporal_aggregation == "yearly":
        grouped = df.groupby(df["date"].dt.to_period("Y"))["value"].mean().reset_index()
        grouped["date"] = grouped["date"].dt.strftime("%Y")
    else:
        return rows
    return [{"date": str(d), "value": float(v)} for d, v in zip(grouped["date"], grouped["value"])]


def _reducer(ee: Any, spatial_reducer: str) -> Any:
    if spatial_reducer == "mean":
        return ee.Reducer.mean()
    if spatial_reducer == "sum":
        return ee.Reducer.sum()
    if spatial_reducer == "median":
        return ee.Reducer.median()
    if spatial_reducer == "min":
        return ee.Reducer.min()
    if spatial_reducer == "max":
        return ee.Reducer.max()
    raise ValueError(f"Unsupported reducer: {spatial_reducer}")


def extract_timeseries(
    *,
    dataset_id: str,
    band: str,
    start_date: str,
    end_date: str,
    roi_geojson: dict[str, Any],
    spatial_reducer: str = "mean",
    temporal_aggregation: str = "daily",
    scale_m: float = 5000.0,
    project_id: str | None = None,
) -> dict[str, Any]:
    ok, ee, err = _import_ee()
    if not ok:
        return {
            "ok": True,
            "mock": True,
            "type": "gee_timeseries",
            "rows": [],
            "message": f"earthengine-api not installed: {err}",
            "provenance": {
                "adapter": "aihydro_gee",
                "operation": "extract_timeseries",
                "dataset_id": dataset_id,
                "band": band,
                "project_id": project_id,
                "mock": True,
            },
        }

    try:
        if project_id:
            ee.Initialize(project=project_id)
        else:
            ee.Initialize()

        roi = ee.Geometry(roi_geojson)
        reducer = _reducer(ee, spatial_reducer)
        collection = ee.ImageCollection(dataset_id).filterDate(start_date, end_date).select(band)

        def _image_to_feature(image: Any) -> Any:
            stats = image.reduceRegion(
                reducer=reducer,
                geometry=roi,
                scale=scale_m,
                bestEffort=True,
                maxPixels=1e13,
            )
            date = ee.Date(image.get("system:time_start")).format("YYYY-MM-dd")
            return ee.Feature(
                None,
                {
                    "date": date,
                    "value": stats.get(band),
                },
            )

        fc = ee.FeatureCollection(collection.map(_image_to_feature))
        info = fc.getInfo()
        raw_rows: list[dict[str, Any]] = []
        for feature in info.get("features", []):
            props = feature.get("properties", {})
            raw_rows.append({"date": props.get("date"), "value": props.get("value")})

        rows = _aggregate_rows(raw_rows, temporal_aggregation)
        return {
            "ok": True,
            "type": "gee_timeseries",
            "rows": rows,
            "provenance": {
                "adapter": "aihydro_gee",
                "operation": "extract_timeseries",
                "dataset_id": dataset_id,
                "band": band,
                "spatial_reducer": spatial_reducer,
                "temporal_aggregation": temporal_aggregation,
                "scale_m": scale_m,
                "project_id": project_id,
                "computed_at": datetime.utcnow().isoformat() + "Z",
            },
        }
    except Exception as exc:
        return {
            "ok": False,
            "type": "gee_timeseries",
            "message": f"Failed to extract timeseries: {exc}",
            "rows": [],
            "provenance": {
                "adapter": "aihydro_gee",
                "operation": "extract_timeseries",
                "dataset_id": dataset_id,
                "band": band,
                "project_id": project_id,
            },
        }
