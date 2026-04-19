"""
Map event writer — pushes GeoJSON layers to the AI-Hydro VS Code map panel.

Writes a small JSON file to ~/.aihydro/map_events/ which the VS Code extension
processes (reads layer, calls addMapLayer, deletes file). The flow is:

    Python MCP tool
        └─ push_layer(...)
            └─ writes ~/.aihydro/map_events/<uuid>.json
                └─ MapEventWatcher.ts reads + deletes it
                    └─ controller.addMapLayer(layer)
                        └─ MapContext streams to MapView (deck.gl renders it)

Designed to be fire-and-forget: callers never wait on the VS Code side.
"""
from __future__ import annotations

import json
import logging
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

log = logging.getLogger(__name__)

_MAP_EVENTS_DIR = Path.home() / ".aihydro" / "map_events"


# Hydrology-specific colour palette ─────────────────────────────────────────

STYLES: dict[str, dict[str, Any]] = {
    "watershed": {
        "fillColor": "#1a6eb5",
        "fillOpacity": 0.20,
        "color": "#0d4a80",
        "strokeColor": "#0d4a80",
        "strokeWidth": 3,
        "weight": 3,
        "opacity": 1.0,
    },
    "flowlines": {
        "fillColor": "#3399ff",
        "fillOpacity": 0.0,
        "color": "#1a73e8",
        "strokeColor": "#1a73e8",
        "strokeWidth": 2,
        "weight": 2,
        "opacity": 0.85,
    },
    "gauge": {
        "fillColor": "#e05c00",
        "fillOpacity": 0.9,
        "color": "#993d00",
        "strokeColor": "#993d00",
        "strokeWidth": 2,
        "weight": 2,
        "opacity": 1.0,
    },
    "default": {
        "fillColor": "#0066CC",
        "fillOpacity": 0.30,
        "color": "#003399",
        "strokeColor": "#003399",
        "strokeWidth": 2,
        "weight": 2,
        "opacity": 1.0,
    },
}


def push_layer(
    layer_id: str,
    name: str,
    geojson: str | dict,
    layer_type: str = "polygon",
    style_preset: str = "default",
    style_override: dict[str, Any] | None = None,
    auto_zoom: bool = True,
    open_map: bool = True,
    metadata: dict[str, str] | None = None,
) -> bool:
    """
    Write a map layer event file for the VS Code extension to pick up.

    Parameters
    ----------
    layer_id    : Unique layer key (e.g. 'watershed_01031500'). Re-sending
                  the same ID replaces the existing layer.
    name        : Human-readable display name shown in the Layers panel.
    geojson     : GeoJSON FeatureCollection / Feature / Geometry as a string
                  or already-parsed dict.
    layer_type  : 'polygon', 'line', 'point', or 'raster'
    style_preset: One of 'watershed', 'flowlines', 'gauge', 'default'.
    style_override: Any style key overrides on top of the preset.
    auto_zoom   : Ask the map to zoom to this layer's extent.
    open_map    : Ask the extension to open the map panel if it is closed.
    metadata    : Extra key/value pairs shown in the Layers panel.

    Returns
    -------
    True if the event file was written successfully, False otherwise.
    The function never raises — map failures are non-fatal.
    """
    try:
        _MAP_EVENTS_DIR.mkdir(parents=True, exist_ok=True)

        geojson_str = geojson if isinstance(geojson, str) else json.dumps(geojson)

        style = {**STYLES.get(style_preset, STYLES["default"]), **(style_override or {})}

        event: dict[str, Any] = {
            "id": layer_id,
            "name": name,
            "geojson": geojson_str,
            "layerType": layer_type,
            "style": style,
            "autoZoom": auto_zoom,
            "openMap": open_map,
            "metadata": metadata or {},
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }

        event_file = _MAP_EVENTS_DIR / f"{uuid.uuid4().hex}.json"
        event_file.write_text(json.dumps(event), encoding="utf-8")
        log.debug("Map event written: %s → %s", layer_id, event_file.name)
        return True

    except Exception as exc:
        log.warning("push_layer failed (non-fatal): %s", exc)
        return False


def push_raster_layer(
    layer_id: str,
    name: str,
    png_path: str,
    bounds_wgs84: list,
    colormap: str = "viridis",
    opacity: float = 0.75,
    auto_zoom: bool = True,
    open_map: bool = True,
    metadata: dict[str, str] | None = None,
) -> bool:
    """
    Write a raster map layer event file (deck.gl BitmapLayer).

    Parameters
    ----------
    layer_id     : Unique layer key, e.g. 'twi_my-session'.
    name         : Display name in the Layers panel.
    png_path     : Absolute path to the tile PNG on disk (decoration-free,
                   transparent NoData cells). Written by plot_raster_tile().
    bounds_wgs84 : [west, south, east, north] in decimal degrees (EPSG:4326).
    colormap     : Colormap name embedded as metadata for the legend hint.
    opacity      : Overall opacity of the raster layer (0–1, default 0.75).
    auto_zoom    : Fit the map to this layer's extent.
    open_map     : Open the map panel if not already visible.
    metadata     : Extra key/value pairs shown in the Layers panel.

    Returns
    -------
    True if the event file was written successfully.
    """
    try:
        _MAP_EVENTS_DIR.mkdir(parents=True, exist_ok=True)

        event: dict[str, Any] = {
            "id": layer_id,
            "name": name,
            "layerType": "raster",
            "raster": {
                "path": str(png_path),
                "bounds": bounds_wgs84,  # [west, south, east, north]
                "opacity": opacity,
                "colormap": colormap,
            },
            "geojson": "",
            "style": {},
            "autoZoom": auto_zoom,
            "openMap": open_map,
            "metadata": {
                "raster_colormap": colormap,
                "raster_bounds": json.dumps(bounds_wgs84),
                **(metadata or {}),
            },
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }

        event_file = _MAP_EVENTS_DIR / f"{uuid.uuid4().hex}.json"
        event_file.write_text(json.dumps(event), encoding="utf-8")
        log.debug("Raster map event written: %s → %s", layer_id, event_file.name)
        return True

    except Exception as exc:
        log.warning("push_raster_layer failed (non-fatal): %s", exc)
        return False


def push_gauge_point(
    layer_id: str,
    name: str,
    lat: float,
    lon: float,
    metadata: dict[str, str] | None = None,
) -> bool:
    """Push a single gauge station point to the map."""
    geojson = {
        "type": "FeatureCollection",
        "features": [
            {
                "type": "Feature",
                "geometry": {"type": "Point", "coordinates": [lon, lat]},
                "properties": {"name": name, **(metadata or {})},
            }
        ],
    }
    return push_layer(
        layer_id=layer_id,
        name=name,
        geojson=geojson,
        layer_type="point",
        style_preset="gauge",
        auto_zoom=False,
        metadata=metadata,
    )
