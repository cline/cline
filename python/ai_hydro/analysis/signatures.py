"""
Hydrological Signatures
=======================

Extract CAMELS-style hydrological signatures from streamflow data.

Public Functions
----------------
extract_hydrological_signatures(gauge_id, watershed_geojson, area_km2,
                                start_date, end_date) -> HydroResult
    Extract 17 CAMELS-style hydrological signatures

compute_flow_stats_camels, compute_water_balance_camels,
compute_event_stats_camels, compute_timing_stats_camels,
compute_slope_fdc_camels — individual signature groups

References
----------
- Addor et al. (2017). The CAMELS data set. HESS.
- Ladson et al. (2013). Baseflow separation. J. Hydrol.
- Sawicz et al. (2011). Catchment classification. WRR.
- Sankarasubramanian et al. (2001). Streamflow elasticity. WRR.
"""

from __future__ import annotations

from typing import Dict, Optional, Tuple
import logging
import warnings

import numpy as np
import pandas as pd

from ai_hydro.core import DataSource, HydroMeta, HydroResult, ToolError
from ai_hydro.data.streamflow import (
    _fetch_streamflow_internal,
    _to_mm_per_day,
)

_SOURCES_NWIS = [
    DataSource(
        name="USGS NWIS",
        url="https://waterservices.usgs.gov/nwis/dv/",
        citation=(
            "@misc{NWIS2024,\n"
            "  title={National Water Information System (NWIS)},\n"
            "  author={{USGS Water Resources Mission Area}},\n"
            "  year={2024},\n"
            "  url={https://waterdata.usgs.gov/nwis}\n"
            "}"
        ),
    )
]
_SOURCES_GRIDMET = [
    DataSource(
        name="GridMET",
        url="https://www.climatologylab.org/gridmet.html",
        citation=(
            "@article{Abatzoglou2013,\n"
            "  title={Development of gridded surface meteorological data for ecological "
            "applications and modelling},\n"
            "  author={Abatzoglou, John T},\n"
            "  journal={International Journal of Climatology},\n"
            "  volume={33}, number={1}, pages={121--131}, year={2013}\n"
            "}"
        ),
    )
]

_TOOL_PATH_SIGNATURES = "ai_hydro.analysis.signatures.extract_hydrological_signatures"

log = logging.getLogger(__name__)
warnings.filterwarnings('ignore')

__all__ = [
    'extract_hydrological_signatures',
    'compute_flow_stats_camels',
    'compute_water_balance_camels',
    'compute_event_stats_camels',
    'compute_timing_stats_camels',
    'compute_slope_fdc_camels',
]


def _get_version() -> str:
    try:
        from importlib.metadata import version
        return version("aihydro-tools")
    except Exception:
        return "unknown"


# ---------------------------------------------------------------------------
# Main entry point
# ---------------------------------------------------------------------------

def extract_hydrological_signatures(
    gauge_id: str,
    watershed_geojson: dict,
    area_km2: float,
    start_date: str = "1989-10-01",
    end_date: str = "2009-09-30",
) -> HydroResult:
    """
    Extract 17 CAMELS-style hydrological signatures for a USGS gauge.

    Parameters
    ----------
    gauge_id : str
        USGS gauge identifier (8-digit code)
    watershed_geojson : dict
        Watershed boundary as GeoJSON polygon dict (from delineate_watershed)
    area_km2 : float
        Watershed area in km²
    start_date : str, optional
        Start date YYYY-MM-DD (default: "1989-10-01" — CAMELS period)
    end_date : str, optional
        End date YYYY-MM-DD (default: "2009-09-30" — CAMELS period)

    Returns
    -------
    HydroResult
        result.data keys (all float, NaN where insufficient data):
        q_mean, q_std, q5, q95, q_median, baseflow_index,
        runoff_ratio, stream_elas, high_q_freq, high_q_dur,
        low_q_freq, low_q_dur, zero_q_freq, flow_variability,
        hfd_mean, half_flow_date_std, slope_fdc

    Raises
    ------
    ToolError
        INVALID_AREA, INVALID_GEOMETRY, DEPENDENCY_ERROR
    """

    log.info("Extracting hydrological signatures for gauge %s (%s to %s)", gauge_id, start_date, end_date)

    if not np.isfinite(area_km2) or area_km2 <= 0:
        raise ToolError(
            code="INVALID_AREA",
            message=f"Invalid watershed area: {area_km2}. Must be positive and finite.",
            tool=_TOOL_PATH_SIGNATURES,
        )

    # Convert GeoJSON dict back to shapely for internal helpers
    try:
        from shapely.geometry import shape
        watershed_geom = shape(watershed_geojson)
    except Exception as e:
        raise ToolError(
            code="INVALID_GEOMETRY",
            message=f"Could not parse watershed_geojson: {e}",
            tool=_TOOL_PATH_SIGNATURES,
            recovery="Pass result.data['geometry_geojson'] from delineate_watershed().",
        ) from e

    try:
        # Fetch streamflow via internal helper (returns old-style dict)
        streamflow_result = _fetch_streamflow_internal(gauge_id, start_date, end_date)

        if streamflow_result is None or len(streamflow_result.get("q_cms", [])) < 365:
            log.warning("Insufficient streamflow data for gauge %s", gauge_id)
            sigs = _get_default_hydrology()
        else:
            q_cms = streamflow_result["q_cms"]
            q_mm_day = _to_mm_per_day(q_cms, area_km2)
            p_mm_day = _fetch_precipitation_data_bygeom(watershed_geom, start_date, end_date)

            sigs = {
                **compute_flow_stats_camels(q_mm_day),
                **compute_water_balance_camels(q_mm_day, p_mm_day),
                **compute_event_stats_camels(q_mm_day),
                **compute_timing_stats_camels(q_mm_day),
                **compute_slope_fdc_camels(q_mm_day),
            }
            log.info("Extracted %d signatures for gauge %s", len(sigs), gauge_id)

        # Ensure all values are JSON-serializable Python floats
        clean = {k: (float(v) if v is not None and np.isfinite(float(v)) else None)
                 for k, v in sigs.items()}

        return HydroResult(
            data=clean,
            meta=HydroMeta(
                tool=_TOOL_PATH_SIGNATURES,
                version=_get_version(),
                gauge_id=gauge_id,
                sources=_SOURCES_NWIS + _SOURCES_GRIDMET,
                params={
                    "gauge_id": gauge_id,
                    "area_km2": area_km2,
                    "start_date": start_date,
                    "end_date": end_date,
                },
            ),
        )

    except ToolError:
        raise
    except ImportError as e:
        raise ToolError(
            code="DEPENDENCY_ERROR",
            message=str(e),
            tool=_TOOL_PATH_SIGNATURES,
            recovery="pip install 'ai-hydro[analysis]'",
        ) from e
    except Exception as e:
        log.error("Error extracting hydrological signatures: %s", e)
        return HydroResult(
            data=_get_default_hydrology(),
            meta=HydroMeta(
                tool=_TOOL_PATH_SIGNATURES,
                version=_get_version(),
                gauge_id=gauge_id,
                sources=_SOURCES_NWIS,
                params={"gauge_id": gauge_id, "error": str(e)},
            ),
        )


# ---------------------------------------------------------------------------
# Signature computation groups
# ---------------------------------------------------------------------------

def compute_flow_stats_camels(q_mm_day: pd.Series) -> Dict[str, float]:
    """
    Compute basic flow statistics following CAMELS methodology.

    Returns: q_mean, q_std, q5, q95, q_median, baseflow_index
    """

    q = q_mm_day.dropna().values

    if len(q) < 365:
        log.warning(f"Insufficient data for flow stats: {len(q)} days (minimum 365)")
        return {k: np.nan for k in [
            "q_mean", "q_std", "q5", "q95", "q_median", "baseflow_index"
        ]}

    q_mean = float(np.mean(q))
    q_std = float(np.std(q))
    q5 = float(np.quantile(q, 0.95))   # High flow (95th percentile)
    q95 = float(np.quantile(q, 0.05))  # Low flow (5th percentile)
    q_med = float(np.median(q))

    # Baseflow index using Lyne-Hollick filter
    bf = _lyne_hollick_baseflow(q, alpha=0.925, passes=3)
    bfi = float(np.nansum(bf) / np.nansum(q)) if np.nansum(q) > 0 else np.nan
    bfi = max(0.0, min(1.0, bfi)) if np.isfinite(bfi) else np.nan

    log.debug(f"Flow stats: mean={q_mean:.2f}, BFI={bfi:.2f}")

    return {
        'q_mean': q_mean,
        'q_std': q_std,
        'q5': q5,
        'q95': q95,
        'q_median': q_med,
        'baseflow_index': bfi,
    }


def compute_water_balance_camels(
    q_mm_day: pd.Series,
    p_mm_day: Optional[pd.Series],
) -> Dict[str, float]:
    """
    Compute water balance metrics (runoff ratio, streamflow elasticity).

    Following Sankarasubramanian et al. (2001).
    Returns: runoff_ratio, stream_elas
    """

    if p_mm_day is None or len(p_mm_day) < 365:
        log.warning("Insufficient precipitation data for water balance")
        return {'runoff_ratio': np.nan, 'stream_elas': np.nan}

    q_aln, p_aln = _align_daily(q_mm_day, p_mm_day, min_days=365)

    if q_aln is None:
        log.warning("Failed to align Q and P time series")
        return {'runoff_ratio': np.nan, 'stream_elas': np.nan}

    mean_q, mean_p = float(q_aln.mean()), float(p_aln.mean())
    rr = mean_q / mean_p if mean_p > 0 else np.nan

    # Streamflow elasticity
    hy = _year_series(q_aln.index, hydro_year_start_month=10)
    mp = pd.Series(p_aln.values, index=hy).groupby(level=0).mean()
    mq = pd.Series(q_aln.values, index=hy).groupby(level=0).mean()

    if len(mp) < 3 or len(mq) < 3:
        log.warning("Insufficient years for elasticity calculation")
        return {'runoff_ratio': rr, 'stream_elas': np.nan}

    mp_tot, mq_tot = float(mp.mean()), float(mq.mean())
    dp, dq = (mp - mp_tot), (mq - mq_tot)

    with np.errstate(divide='ignore', invalid='ignore'):
        ratio = (dq / mq_tot) / (dp / mp_tot)

    ratio = ratio.replace([np.inf, -np.inf], np.nan).dropna()
    elas = float(np.median(ratio)) if len(ratio) > 0 else np.nan

    log.debug(f"Water balance: RR={rr:.2f}, elasticity={elas:.2f}")

    return {'runoff_ratio': rr, 'stream_elas': elas}


def compute_event_stats_camels(q_mm_day: pd.Series) -> Dict[str, float]:
    """
    Compute extreme event statistics (high/low flow frequency and duration).

    Returns: high_q_freq, high_q_dur, low_q_freq, low_q_dur,
             zero_q_freq, flow_variability
    """

    q = q_mm_day.dropna().values

    if len(q) == 0:
        log.warning("No valid discharge data for event stats")
        return {k: np.nan for k in [
            "high_q_freq", "high_q_dur", "low_q_freq", "low_q_dur",
            "zero_q_freq", "flow_variability"
        ]}

    med_q, mean_q = np.median(q), np.mean(q)

    if mean_q <= 0:
        log.warning("Mean discharge <= 0, cannot compute event stats")
        return {k: np.nan for k in [
            "high_q_freq", "high_q_dur", "low_q_freq", "low_q_dur",
            "zero_q_freq", "flow_variability"
        ]}

    # High flow events (> 9x median)
    high_mask = (q > 9.0 * med_q)
    high_freq = float(np.sum(high_mask) / len(q) * 365.25)
    high_dur = _consecutive_event_lengths(high_mask)
    high_dur_mean = float(np.mean(high_dur)) if high_dur else np.nan

    # Low flow events (<= 0.2x mean)
    low_mask = (q <= 0.2 * mean_q)
    low_freq = float(np.sum(low_mask) / len(q) * 365.25)
    low_dur = _consecutive_event_lengths(low_mask)
    low_dur_mean = float(np.mean(low_dur)) if low_dur else np.nan

    # Zero flow frequency
    zero_freq = float(np.sum(q == 0) / len(q))

    # Flow variability (coefficient of variation)
    flow_var = float(np.std(q) / mean_q)

    log.debug(f"Event stats: high_freq={high_freq:.1f}, low_freq={low_freq:.1f}")

    return {
        'high_q_freq': high_freq,
        'high_q_dur': high_dur_mean,
        'low_q_freq': low_freq,
        'low_q_dur': low_dur_mean,
        'zero_q_freq': zero_freq,
        'flow_variability': flow_var,
    }


def compute_timing_stats_camels(q_mm_day: pd.Series) -> Dict[str, float]:
    """
    Compute flow timing statistics (half-flow date mean and variability).

    Returns: hfd_mean, half_flow_date_std
    """

    if q_mm_day is None or len(q_mm_day) < 365:
        log.warning("Insufficient data for timing stats")
        return {'hfd_mean': np.nan, 'half_flow_date_std': np.nan}

    df = q_mm_day.dropna().to_frame("q")
    hy = _year_series(df.index, hydro_year_start_month=10)
    hyd_start = pd.to_datetime([f"{y-1}-10-01" for y in hy])
    df["day"] = (df.index - hyd_start).days + 1
    df["hy"] = hy

    hfd_list = []
    for g, grp in df.groupby("hy"):
        qsum = grp["q"].sum()
        if len(grp) >= 300 and qsum > 0:
            csum = grp["q"].cumsum()
            idx = np.argmax(csum.values >= 0.5 * qsum)
            hfd_list.append(int(grp["day"].iloc[idx]))

    if len(hfd_list) >= 2:
        log.debug(f"Timing stats: {len(hfd_list)} years analyzed")
        return {
            'hfd_mean': float(np.mean(hfd_list)),
            'half_flow_date_std': float(np.std(hfd_list)),
        }

    log.warning(f"Insufficient years for timing stats: {len(hfd_list)}")
    return {'hfd_mean': np.nan, 'half_flow_date_std': np.nan}


def compute_slope_fdc_camels(q_mm_day: pd.Series) -> Dict[str, float]:
    """
    Compute slope of flow duration curve between 33% and 66% exceedance.

    Following Sawicz et al. (2011).
    Returns: slope_fdc
    """

    q = q_mm_day.dropna().values
    q = q[q > 0]

    if len(q) < 100:
        log.warning(f"Insufficient positive discharge values for FDC: {len(q)}")
        return {'slope_fdc': np.nan}

    q33 = np.quantile(q, 0.67)  # 33% exceedance
    q66 = np.quantile(q, 0.34)  # 66% exceedance

    if q66 <= 0 or q33 <= 0:
        log.warning("Invalid quantiles for FDC slope")
        return {'slope_fdc': np.nan}

    slope = (np.log(q33) - np.log(q66)) / (0.66 - 0.33)

    log.debug(f"FDC slope: {slope:.3f}")

    return {'slope_fdc': float(slope)}


# ---------------------------------------------------------------------------
# Private helpers
# ---------------------------------------------------------------------------

def _fetch_precipitation_data_bygeom(
    watershed_geom,
    start_date: str,
    end_date: str,
) -> Optional[pd.Series]:
    """Fetch GridMET precipitation for water balance calculations."""

    try:
        import pygridmet as gridmet
    except ImportError:
        log.warning("pygridmet not installed, skipping precipitation data")
        return None

    try:
        log.info("Fetching GridMET precipitation data")
        ds = gridmet.get_bygeom(
            geometry=watershed_geom,
            dates=(start_date, end_date),
            variables=["pr"],
            crs="EPSG:4326",
        )

        if "pr" not in ds.data_vars:
            log.warning("Precipitation variable not found in GridMET response")
            return None

        pr_daily = ds["pr"].mean(dim=["lat", "lon"])
        s = pr_daily.to_series().dropna()
        s.index = pd.to_datetime(s.index).tz_localize(None)
        s.name = "precip_mm"

        log.info(f"Retrieved {len(s)} days of precipitation data")
        return s

    except Exception as e:
        # Common causes: pandas 2.x DateOffset/Timedelta incompatibility inside
        # pygridmet, network timeouts, or missing spatial data for the watershed.
        # Returning None causes water-balance signatures to be NaN, which is safe.
        log.warning("Precipitation fetch skipped (runoff_ratio/stream_elas will be NaN): %s", e)
        return None


def _lyne_hollick_baseflow(
    q: np.ndarray,
    alpha: float = 0.925,
    passes: int = 3,
) -> np.ndarray:
    """Lyne-Hollick digital filter for baseflow separation."""

    if q.size == 0 or np.all(~np.isfinite(q)):
        return np.full_like(q, np.nan, dtype=float)

    def one_pass_forward(x):
        y = np.zeros_like(x, dtype=float)
        y[0] = x[0]
        for t in range(1, len(x)):
            y[t] = alpha * y[t-1] + (1 + alpha) / 2 * (x[t] - x[t-1])
            y[t] = min(max(y[t], 0.0), x[t])
        return y

    def one_pass_backward(x):
        y = np.zeros_like(x, dtype=float)
        y[-1] = x[-1]
        for t in range(len(x) - 2, -1, -1):
            y[t] = alpha * y[t+1] + (1 + alpha) / 2 * (x[t] - x[t+1])
            y[t] = min(max(y[t], 0.0), x[t])
        return y

    bf = q.copy().astype(float)
    for _ in range(passes):
        bf = one_pass_forward(bf)
        bf = one_pass_backward(bf)

    return np.clip(bf, 0, q)


def _align_daily(
    q_series: pd.Series,
    p_series: pd.Series,
    min_days: int = 365,
) -> Tuple[Optional[pd.Series], Optional[pd.Series]]:
    """Align two daily time series to common index."""

    if q_series is None or p_series is None:
        return None, None

    qi = pd.to_datetime(q_series.index).tz_localize(None)
    pi = pd.to_datetime(p_series.index).tz_localize(None)

    q = pd.Series(q_series.values, index=qi, dtype=float).dropna()
    p = pd.Series(p_series.values, index=pi, dtype=float).dropna()

    common = q.index.intersection(p.index)

    if len(common) < min_days:
        return None, None

    return q.loc[common], p.loc[common]


def _year_series(dti: pd.DatetimeIndex, hydro_year_start_month: int = 10) -> np.ndarray:
    """Compute hydrologic year ID for each date."""
    return dti.year + (dti.month >= hydro_year_start_month).astype(int)


def _consecutive_event_lengths(mask: np.ndarray) -> list:
    """Calculate lengths of consecutive True values in boolean mask."""
    lengths = []
    count = 0
    for v in mask:
        if v:
            count += 1
        elif count > 0:
            lengths.append(count)
            count = 0
    if count > 0:
        lengths.append(count)
    return lengths


def _get_default_hydrology() -> Dict[str, float]:
    """Return default hydrological values when data unavailable."""
    return {
        'q_mean': np.nan,
        'q_std': np.nan,
        'q5': np.nan,
        'q95': np.nan,
        'q_median': np.nan,
        'baseflow_index': np.nan,
        'runoff_ratio': np.nan,
        'stream_elas': np.nan,
        'high_q_freq': np.nan,
        'high_q_dur': np.nan,
        'low_q_freq': np.nan,
        'low_q_dur': np.nan,
        'zero_q_freq': np.nan,
        'flow_variability': np.nan,
        'hfd_mean': np.nan,
        'half_flow_date_std': np.nan,
        'slope_fdc': np.nan,
    }
