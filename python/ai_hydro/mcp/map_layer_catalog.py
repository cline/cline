"""Read host map layer catalog and compute graduated symbology breaks."""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any

MAP_LAYER_CATALOG_FILE = Path.home() / ".aihydro" / "map_layer_catalog.json"

COLOR_RAMPS: dict[str, list[str]] = {
    "viridis": ["#440154", "#31688e", "#35b779", "#fde725"],
    "plasma": ["#0d0887", "#cc4778", "#f89441", "#f0f921"],
    "YlOrRd": ["#ffffb2", "#fecc5c", "#e31a1c"],
    "Blues": ["#f7fbff", "#6baed6", "#084594"],
    "RdYlGn": ["#d73027", "#fee08b", "#1a9850"],
    "Greens": ["#f7fcfd", "#78c679", "#005a32"],
    "Reds": ["#fee5d9", "#fcae91", "#cb181d"],
    "Purples": ["#f7fcfd", "#9e9ac8", "#54278f"],
}


def read_layer_catalog() -> dict[str, Any]:
    try:
        return json.loads(MAP_LAYER_CATALOG_FILE.read_text(encoding="utf-8"))
    except Exception:
        return {"layers": [], "layer_order": []}


def find_catalog_layer(layer_id: str) -> dict[str, Any] | None:
    catalog = read_layer_catalog()
    for layer in catalog.get("layers") or []:
        if layer.get("id") == layer_id:
            return layer
    return None


def list_layer_ids() -> list[str]:
    catalog = read_layer_catalog()
    return [str(l.get("id")) for l in catalog.get("layers") or [] if l.get("id")]


def _extract_values(geojson: dict[str, Any], attribute: str) -> list[float]:
    features = geojson.get("features") if geojson.get("type") == "FeatureCollection" else [geojson]
    values: list[float] = []
    for feat in features:
        if not isinstance(feat, dict):
            continue
        props = feat.get("properties") or {}
        val = props.get(attribute)
        if isinstance(val, (int, float)):
            values.append(float(val))
    return values


def equal_interval_breaks(min_val: float, max_val: float, num_classes: int) -> list[float]:
    if num_classes < 2:
        return [max_val]
    step = (max_val - min_val) / num_classes
    breaks = [min_val + i * step for i in range(1, num_classes)]
    breaks.append(max_val)
    return breaks


def quantile_breaks(values: list[float], num_classes: int) -> list[float]:
    if not values:
        return []
    sorted_vals = sorted(values)
    breaks: list[float] = []
    for i in range(1, num_classes + 1):
        idx = max(0, int((i / num_classes) * len(sorted_vals)) - 1)
        breaks.append(sorted_vals[idx])
    return sorted(set(breaks))


def ramp_colors(ramp_name: str, num_classes: int) -> list[str]:
    ramp = COLOR_RAMPS.get(ramp_name, COLOR_RAMPS["viridis"])
    if num_classes <= 1:
        return [ramp[-1]]
    out: list[str] = []
    for i in range(num_classes):
        t = i / max(1, num_classes - 1)
        pos = t * (len(ramp) - 1)
        idx = int(pos)
        out.append(ramp[min(idx, len(ramp) - 1)])
    return out


def compute_graduated_metadata(
    geojson: dict[str, Any],
    *,
    attribute: str,
    method: str = "quantile",
    num_classes: int = 5,
    color_ramp: str = "viridis",
) -> dict[str, str]:
    values = _extract_values(geojson, attribute)
    if not values:
        raise ValueError(f"No numeric values for attribute '{attribute}'")
    num_classes = max(2, min(12, int(num_classes)))
    min_val = min(values)
    max_val = max(values)
    method_norm = (method or "quantile").lower()
    if method_norm in ("equal", "equal_interval", "equalintervals"):
        breaks = equal_interval_breaks(min_val, max_val, num_classes)
    else:
        breaks = quantile_breaks(values, num_classes)
    if not breaks:
        breaks = [max_val]
    colors = ramp_colors(color_ramp, len(breaks))
    return {
        "graduated_attr": attribute,
        "graduated_method": method_norm,
        "graduated_breaks": json.dumps(breaks),
        "graduated_colors": json.dumps(colors),
        "graduated_ramp": color_ramp,
    }


def load_geojson_for_layer(
    catalog_entry: dict[str, Any],
    workspace_root: str | None,
) -> dict[str, Any]:
    rel = (catalog_entry.get("workspace_path") or "").strip()
    if rel and workspace_root:
        path = Path(workspace_root) / rel
        if path.exists():
            return json.loads(path.read_text(encoding="utf-8"))
    cache = (catalog_entry.get("geojson_cache_path") or "").strip()
    if cache:
        cache_path = Path(cache)
        if cache_path.exists():
            return json.loads(cache_path.read_text(encoding="utf-8"))
    raise ValueError(
        "Layer geometry not available in catalog (no workspace_path or geojson_cache_path). "
        "Load the file on the map first or use a layer pushed with show_on_map."
    )
