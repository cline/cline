from __future__ import annotations

import json
from typing import Any

from .auth import _import_ee


def _reduce_collection(collection: Any, reducer: str) -> Any:
    if reducer == "sum":
        return collection.sum()
    if reducer == "mean":
        return collection.mean()
    if reducer == "median":
        return collection.median()
    if reducer == "min":
        return collection.min()
    if reducer == "max":
        return collection.max()
    raise ValueError(f"Unsupported reducer: {reducer}")


def preview_layer(
    *,
    dataset_id: str,
    band: str,
    start_date: str,
    end_date: str,
    roi_geojson: dict[str, Any] | None = None,
    reducer: str = "sum",
    visualization: dict[str, Any] | None = None,
    project_id: str | None = None,
) -> dict[str, Any]:
    ok, ee, err = _import_ee()
    if not ok:
        return _error_result(
            dataset_id=dataset_id,
            band=band,
            start_date=start_date,
            end_date=end_date,
            project_id=project_id,
            reducer=reducer,
            msg=f"earthengine-api not installed: {err}",
        )

    try:
        if project_id:
            ee.Initialize(project=project_id)
        else:
            ee.Initialize()

        collection = ee.ImageCollection(dataset_id).filterDate(start_date, end_date).select(band)
        image = _reduce_collection(collection, reducer)

        bounds = [-180.0, -60.0, 180.0, 84.0]
        if roi_geojson:
            roi = ee.Geometry(roi_geojson)
            image = image.clip(roi)
            bb = roi.bounds().coordinates().getInfo()
            ring = bb[0]
            xs = [pt[0] for pt in ring]
            ys = [pt[1] for pt in ring]
            bounds = [min(xs), min(ys), max(xs), max(ys)]

        vis = visualization or {
            "min": 0,
            "max": 300,
            "palette": ["081d58", "225ea8", "41b6c4", "a1dab4", "ffffcc"],
        }
        map_info = image.getMapId(vis)
        tile_url_template = map_info["tile_fetcher"].url_format

        return {
            "ok": True,
            "type": "gee_tile_layer",
            "name": f"{dataset_id}:{band}",
            "dataset_id": dataset_id,
            "band": band,
            "start_date": start_date,
            "end_date": end_date,
            "tile_url": tile_url_template,
            "tile_url_template": tile_url_template,
            "bounds_wgs84": bounds,
            "reducer": reducer,
            "provenance": {
                "adapter": "aihydro_gee",
                "operation": "preview_layer",
                "dataset_id": dataset_id,
                "band": band,
                "reducer": reducer,
                "project_id": project_id,
            },
        }
    except Exception as exc:
        return _error_result(
            dataset_id=dataset_id,
            band=band,
            start_date=start_date,
            end_date=end_date,
            project_id=project_id,
            reducer=reducer,
            msg=f"GEE unavailable: {exc}",
        )


def preview_chirps_layer(
    *,
    start_date: str,
    end_date: str,
    project_id: str | None = None,
    roi_geojson: str | None = None,
) -> dict[str, Any]:
    parsed_roi = json.loads(roi_geojson) if roi_geojson else None
    result = preview_layer(
        dataset_id="UCSB-CHC/CHIRPS/V3/DAILY_SAT",
        band="precipitation",
        start_date=start_date,
        end_date=end_date,
        roi_geojson=parsed_roi,
        reducer="sum",
        visualization={"min": 0, "max": 300, "palette": ["081d58", "225ea8", "41b6c4", "a1dab4", "ffffcc"]},
        project_id=project_id,
    )
    if result.get("ok"):
        result["name"] = "CHIRPS precipitation"
    return result


def _error_result(
    *,
    dataset_id: str,
    band: str,
    start_date: str,
    end_date: str,
    project_id: str | None,
    reducer: str,
    msg: str,
) -> dict[str, Any]:
    return {
        "ok": False,
        "type": "gee_tile_layer",
        "name": f"{dataset_id}:{band}",
        "dataset_id": dataset_id,
        "band": band,
        "start_date": start_date,
        "end_date": end_date,
        "bounds_wgs84": [-180.0, -60.0, 180.0, 84.0],
        "message": msg,
        "reducer": reducer,
        "provenance": {
            "adapter": "aihydro_gee",
            "operation": "preview_layer",
            "dataset_id": dataset_id,
            "band": band,
            "reducer": reducer,
            "project_id": project_id,
        },
    }
