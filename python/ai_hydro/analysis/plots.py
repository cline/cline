"""
Standard diagnostic plots for AI-Hydro analysis tools.

Each function accepts the data already computed by the analysis layer,
saves a PNG to output_dir, and returns the file path (or None on failure).
All use the Agg backend so they work in headless/MCP server environments.

Functions
---------
plot_watershed_map(geojson, gauge_lat, gauge_lon, gauge_name, output_dir, gauge_id) -> str | None
plot_hydrograph(dates, q_cms, gauge_name, gauge_id, output_dir) -> str | None
plot_flow_duration_curve(q_cms, signatures, gauge_id, output_dir) -> str | None
"""
from __future__ import annotations

import logging
import os
from typing import Optional

import numpy as np

log = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Backend guard — import once so callers don't need to worry about it
# ---------------------------------------------------------------------------
try:
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    import matplotlib.ticker as mticker
    _MPL_AVAILABLE = True
except ImportError:
    _MPL_AVAILABLE = False


def _mpl_required(fn):
    """Decorator: skip and return None if matplotlib is not installed."""
    def wrapper(*args, **kwargs):
        if not _MPL_AVAILABLE:
            log.warning("matplotlib not available — %s skipped", fn.__name__)
            return None
        try:
            return fn(*args, **kwargs)
        except Exception as exc:
            log.warning("%s failed: %s", fn.__name__, exc)
            return None
    wrapper.__name__ = fn.__name__
    return wrapper


# ---------------------------------------------------------------------------
# Plot 1: Watershed boundary map
# ---------------------------------------------------------------------------

@_mpl_required
def plot_watershed_map(
    geojson: dict,
    gauge_lat: float,
    gauge_lon: float,
    gauge_name: str,
    output_dir: str,
    gauge_id: str,
) -> Optional[str]:
    """
    Plot watershed boundary + gauge location on a simple coordinate map.

    Parameters
    ----------
    geojson : dict
        Watershed GeoJSON geometry (Polygon or MultiPolygon).
    gauge_lat, gauge_lon : float
        Gauge outlet coordinates in WGS84 decimal degrees.
    gauge_name : str
        Station name for the title.
    output_dir : str
        Directory where the PNG is written.
    gauge_id : str
        8-digit USGS gauge ID (used in filename).

    Returns
    -------
    str
        Absolute path to the saved PNG, or None on failure.
    """
    import geopandas as gpd
    from matplotlib.patches import Patch
    from shapely.geometry import shape

    geom = shape(geojson)
    gdf = gpd.GeoDataFrame(geometry=[geom], crs="EPSG:4326")

    fig, ax = plt.subplots(figsize=(8, 7))

    gdf.plot(ax=ax, facecolor="#AED6F1", edgecolor="#1A5276", linewidth=1.5, alpha=0.6)

    gauge_line, = ax.plot(
        gauge_lon,
        gauge_lat,
        marker="^",
        color="#E74C3C",
        markersize=10,
        zorder=5,
        label=f"Gauge {gauge_id}",
        linestyle="none",
    )
    ax.annotate(
        f"  {gauge_id}",
        xy=(gauge_lon, gauge_lat),
        fontsize=9,
        color="#C0392B",
        va="center",
    )

    minx, miny, maxx, maxy = gdf.total_bounds
    pad_x = (maxx - minx) * 0.08
    pad_y = (maxy - miny) * 0.08
    ax.set_xlim(minx - pad_x, maxx + pad_x)
    ax.set_ylim(miny - pad_y, maxy + pad_y)

    ax.set_xlabel("Longitude (°E)", fontsize=10)
    ax.set_ylabel("Latitude (°N)", fontsize=10)
    ax.set_title(
        f"Watershed — {gauge_name or gauge_id}\n"
        f"USGS gauge {gauge_id}  |  WGS84",
        fontsize=11,
        fontweight="bold",
    )
    legend_handles = [
        Patch(facecolor="#AED6F1", edgecolor="#1A5276", label="Watershed boundary"),
        gauge_line,
    ]
    ax.legend(handles=legend_handles, loc="lower right", fontsize=9)
    ax.grid(True, linestyle="--", alpha=0.4)
    ax.ticklabel_format(useOffset=False)

    plt.tight_layout()
    out_path = os.path.join(output_dir, f"watershed_{gauge_id}_map.png")
    plt.savefig(out_path, dpi=200, bbox_inches="tight")
    plt.close()
    log.info("Watershed map saved: %s", out_path)
    return out_path


# ---------------------------------------------------------------------------
# Plot 2: Hydrograph
# ---------------------------------------------------------------------------

@_mpl_required
def plot_hydrograph(
    dates: list,
    q_cms: list,
    gauge_name: str,
    gauge_id: str,
    output_dir: str,
) -> Optional[str]:
    """
    Plot daily discharge hydrograph with 30-day rolling mean.

    Parameters
    ----------
    dates : list[str]
        ISO-format date strings (YYYY-MM-DD).
    q_cms : list[float]
        Discharge in m³/s, one value per date.
    gauge_name : str
        Station name for the title.
    gauge_id : str
        8-digit USGS gauge ID (used in filename).
    output_dir : str
        Directory where the PNG is written.

    Returns
    -------
    str
        Absolute path to the saved PNG, or None on failure.
    """
    import pandas as pd

    q = pd.Series(q_cms, index=pd.to_datetime(dates), dtype=float)
    q = q.dropna()
    if len(q) == 0:
        log.warning("plot_hydrograph: no valid data for gauge %s", gauge_id)
        return None

    rolling = q.rolling(30, center=True, min_periods=15).mean()

    fig, ax = plt.subplots(figsize=(12, 4))

    ax.fill_between(q.index, q.values, alpha=0.25, color="#2980B9", label="Daily Q")
    ax.plot(q.index, q.values, color="#2980B9", linewidth=0.4, alpha=0.6)
    ax.plot(rolling.index, rolling.values, color="#E74C3C", linewidth=1.5,
            label="30-day mean")

    ax.set_xlabel("Date", fontsize=10)
    ax.set_ylabel("Discharge (m³/s)", fontsize=10)
    ax.set_title(
        f"Hydrograph — {gauge_name or gauge_id}  (USGS {gauge_id})\n"
        f"{q.index[0].strftime('%Y-%m-%d')} to {q.index[-1].strftime('%Y-%m-%d')}  "
        f"|  n = {len(q):,} days",
        fontsize=11,
        fontweight="bold",
    )
    ax.legend(fontsize=9)
    ax.grid(True, linestyle="--", alpha=0.4)
    ax.yaxis.set_major_formatter(mticker.FuncFormatter(lambda v, _: f"{v:.1f}"))

    plt.tight_layout()
    out_path = os.path.join(output_dir, f"hydrograph_{gauge_id}.png")
    plt.savefig(out_path, dpi=200, bbox_inches="tight")
    plt.close()
    log.info("Hydrograph saved: %s", out_path)
    return out_path


# ---------------------------------------------------------------------------
# Plot 3: Flow Duration Curve + signature summary
# ---------------------------------------------------------------------------

@_mpl_required
def plot_flow_duration_curve(
    q_cms: list,
    signatures: dict,
    gauge_id: str,
    output_dir: str,
) -> Optional[str]:
    """
    Plot flow duration curve (log-scale) annotated with key signatures.

    Parameters
    ----------
    q_cms : list[float]
        Daily discharge in m³/s.
    signatures : dict
        Output from extract_hydrological_signatures — used to annotate q5/q95
        and BFI.
    gauge_id : str
        8-digit USGS gauge ID (used in filename).
    output_dir : str
        Directory where the PNG is written.

    Returns
    -------
    str
        Absolute path to the saved PNG, or None on failure.
    """
    import pandas as pd

    q = pd.Series(q_cms, dtype=float).dropna()
    q = q[q > 0]
    if len(q) < 30:
        log.warning("plot_flow_duration_curve: too few valid values for gauge %s", gauge_id)
        return None

    q_sorted = np.sort(q.values)[::-1]
    exceedance = np.arange(1, len(q_sorted) + 1) / len(q_sorted) * 100

    fig, axes = plt.subplots(1, 2, figsize=(13, 5))

    # Left: FDC
    ax = axes[0]
    ax.semilogy(exceedance, q_sorted, color="#2980B9", linewidth=1.8)
    ax.fill_between(exceedance, q_sorted, alpha=0.12, color="#2980B9")

    # Mark Q5 and Q95
    q5_val  = np.percentile(q_sorted, 95)   # 5% exceedance = high flow
    q95_val = np.percentile(q_sorted, 5)    # 95% exceedance = low flow
    ax.axvline(5,  color="#E74C3C", linestyle="--", linewidth=1.2,
               label=f"Q5  = {q5_val:.2f} m³/s")
    ax.axvline(95, color="#E67E22", linestyle="--", linewidth=1.2,
               label=f"Q95 = {q95_val:.3f} m³/s")

    ax.set_xlabel("Exceedance probability (%)", fontsize=10)
    ax.set_ylabel("Discharge (m³/s)", fontsize=10)
    ax.set_title("Flow Duration Curve", fontsize=11, fontweight="bold")
    ax.legend(fontsize=9)
    ax.grid(True, which="both", linestyle="--", alpha=0.4)
    ax.set_xlim(0, 100)

    # Right: signature summary table
    ax2 = axes[1]
    ax2.axis("off")

    rows = []
    label_map = [
        ("q_mean",         "Mean Q (mm/day)"),
        ("baseflow_index", "BFI"),
        ("runoff_ratio",   "Runoff ratio"),
        ("high_q_freq",    "High-flow freq (d/yr)"),
        ("low_q_freq",     "Low-flow freq (d/yr)"),
        ("high_q_dur",     "High-flow dur (d)"),
        ("low_q_dur",      "Low-flow dur (d)"),
        ("zero_q_freq",    "Zero-flow fraction"),
        ("slope_fdc",      "FDC slope"),
        ("hfd_mean",       "Half-flow date (day)"),
    ]
    for key, label in label_map:
        val = signatures.get(key)
        if val is not None and not (isinstance(val, float) and np.isnan(val)):
            rows.append([label, f"{val:.3f}"])

    if rows:
        tbl = ax2.table(
            cellText=rows,
            colLabels=["Signature", "Value"],
            cellLoc="left",
            loc="center",
            bbox=[0, 0, 1, 1],
        )
        tbl.auto_set_font_size(False)
        tbl.set_fontsize(9)
        tbl.auto_set_column_width([0, 1])
        for (r, c), cell in tbl.get_celld().items():
            cell.set_edgecolor("#CCCCCC")
            if r == 0:
                cell.set_facecolor("#2C3E50")
                cell.set_text_props(color="white", fontweight="bold")
            else:
                cell.set_facecolor("#F2F3F4" if r % 2 == 0 else "white")

    ax2.set_title("Hydrological Signatures", fontsize=11, fontweight="bold")

    plt.suptitle(f"USGS gauge {gauge_id}", fontsize=10, y=1.01)
    plt.tight_layout()
    out_path = os.path.join(output_dir, f"fdc_{gauge_id}.png")
    plt.savefig(out_path, dpi=200, bbox_inches="tight")
    plt.close()
    log.info("FDC plot saved: %s", out_path)
    return out_path


# ---------------------------------------------------------------------------
# Plot 4: Raster tile — clean georeferenced PNG for map overlay
# ---------------------------------------------------------------------------

@_mpl_required
def plot_raster_tile(
    array: "np.ndarray",
    bounds_wgs84: list,
    output_dir: str,
    name: str,
    colormap: str = "viridis",
    nodata_alpha: bool = True,
) -> Optional[tuple]:
    """
    Save a clean, decoration-free PNG suitable for use as a map tile overlay.

    No axes, no title, no colorbar — just the colormap applied to the data
    array with NaN cells rendered as transparent (alpha=0). The returned
    bounds tuple is the geographic extent in WGS84 ready for deck.gl
    BitmapLayer: [west, south, east, north].

    Parameters
    ----------
    array       : 2D float numpy array (NaN = nodata).
    bounds_wgs84: [west, south, east, north] in decimal degrees.
    output_dir  : Directory to write the PNG.
    name        : Output filename stem (no extension).
    colormap    : matplotlib colormap name (default: 'viridis').
    nodata_alpha: Render NaN cells as fully transparent (default: True).

    Returns
    -------
    (path, bounds_list) — PNG path and WGS84 bounds, or None on failure.
    """
    from matplotlib.colors import Normalize

    arr = np.asarray(array, dtype=float)

    valid = arr[np.isfinite(arr)]
    if len(valid) == 0:
        log.warning("plot_raster_tile: no valid pixels for %s", name)
        return None

    vmin, vmax = float(np.percentile(valid, 2)), float(np.percentile(valid, 98))
    if vmin == vmax:
        vmax = vmin + 1.0

    norm = Normalize(vmin=vmin, vmax=vmax)
    cmap = plt.get_cmap(colormap)

    rgba = cmap(norm(arr))  # shape (H, W, 4), values 0–1

    if nodata_alpha:
        alpha_mask = np.isfinite(arr).astype(float)
        rgba[..., 3] = alpha_mask

    # Flip vertically — raster row 0 is north, image row 0 is top
    rgba_flipped = rgba[::-1, :, :]

    os.makedirs(output_dir, exist_ok=True)
    out_path = os.path.join(output_dir, f"{name}_tile.png")

    fig, ax = plt.subplots(
        figsize=(rgba_flipped.shape[1] / 100, rgba_flipped.shape[0] / 100),
        dpi=100,
    )
    ax.imshow(rgba_flipped, aspect="auto", interpolation="nearest")
    ax.axis("off")
    plt.subplots_adjust(left=0, right=1, top=1, bottom=0)
    plt.savefig(out_path, dpi=100, bbox_inches="tight", pad_inches=0, transparent=True)
    plt.close()

    log.info("Raster tile saved: %s  bounds=%s", out_path, bounds_wgs84)
    return out_path, bounds_wgs84
