from __future__ import annotations

import argparse
import json
import sys

from .auth import connect, list_projects, set_project, status
from .map_layers import preview_chirps_layer, preview_layer
from .timeseries import extract_timeseries


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="aihydro-gee")
    sub = p.add_subparsers(dest="command", required=True)

    p_status = sub.add_parser("status")
    p_status.add_argument("--project-id", type=str, default=None)
    p_status.add_argument("--json", action="store_true")

    p_connect = sub.add_parser("connect")
    p_connect.add_argument("--project-id", type=str, default=None)
    p_connect.add_argument("--json", action="store_true")

    p_projects = sub.add_parser("list-projects")
    p_projects.add_argument("--json", action="store_true")

    p_set_project = sub.add_parser("set-project")
    p_set_project.add_argument("--project-id", required=True)
    p_set_project.add_argument("--json", action="store_true")

    p_preview = sub.add_parser("preview-chirps")
    p_preview.add_argument("--start-date", required=True)
    p_preview.add_argument("--end-date", required=True)
    p_preview.add_argument("--project-id", type=str, default=None)
    p_preview.add_argument("--roi-geojson", type=str, default=None)
    p_preview.add_argument("--json", action="store_true")

    p_preview_layer = sub.add_parser("preview-layer")
    p_preview_layer.add_argument("--dataset-id", required=True)
    p_preview_layer.add_argument("--band", required=True)
    p_preview_layer.add_argument("--start-date", required=True)
    p_preview_layer.add_argument("--end-date", required=True)
    p_preview_layer.add_argument("--reducer", default="sum")
    p_preview_layer.add_argument("--project-id", type=str, default=None)
    p_preview_layer.add_argument("--roi-geojson", type=str, default=None)
    p_preview_layer.add_argument("--visualization-json", type=str, default=None)
    p_preview_layer.add_argument("--json", action="store_true")

    p_ts = sub.add_parser("extract-timeseries")
    p_ts.add_argument("--dataset-id", required=True)
    p_ts.add_argument("--band", required=True)
    p_ts.add_argument("--start-date", required=True)
    p_ts.add_argument("--end-date", required=True)
    p_ts.add_argument("--roi-geojson", required=True)
    p_ts.add_argument("--spatial-reducer", default="mean")
    p_ts.add_argument("--temporal-aggregation", default="daily")
    p_ts.add_argument("--scale-m", type=float, default=5000.0)
    p_ts.add_argument("--project-id", type=str, default=None)
    p_ts.add_argument("--json", action="store_true")

    return p


def main() -> int:
    args = build_parser().parse_args()

    if args.command == "status":
        out = status(project_id=args.project_id)
    elif args.command == "connect":
        out = connect(project_id=args.project_id)
    elif args.command == "list-projects":
        out = list_projects()
    elif args.command == "set-project":
        out = set_project(args.project_id)
    elif args.command == "preview-chirps":
        out = preview_chirps_layer(
            start_date=args.start_date,
            end_date=args.end_date,
            project_id=args.project_id,
            roi_geojson=args.roi_geojson,
        )
    elif args.command == "preview-layer":
        vis = json.loads(args.visualization_json) if args.visualization_json else None
        roi = json.loads(args.roi_geojson) if args.roi_geojson else None
        out = preview_layer(
            dataset_id=args.dataset_id,
            band=args.band,
            start_date=args.start_date,
            end_date=args.end_date,
            roi_geojson=roi,
            reducer=args.reducer,
            visualization=vis,
            project_id=args.project_id,
        )
    elif args.command == "extract-timeseries":
        out = extract_timeseries(
            dataset_id=args.dataset_id,
            band=args.band,
            start_date=args.start_date,
            end_date=args.end_date,
            roi_geojson=json.loads(args.roi_geojson),
            spatial_reducer=args.spatial_reducer,
            temporal_aggregation=args.temporal_aggregation,
            scale_m=args.scale_m,
            project_id=args.project_id,
        )
    else:  # pragma: no cover
        out = {"ok": False, "message": f"Unknown command: {args.command}"}

    print(json.dumps(out, ensure_ascii=True))
    return 0 if out.get("ok") else 1


if __name__ == "__main__":
    sys.exit(main())
