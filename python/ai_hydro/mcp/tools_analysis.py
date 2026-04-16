"""
Analysis MCP tools (9 tools).

Watershed delineation, streamflow, signatures, geomorphic parameters,
TWI, curve number grid, forcing data, CAMELS attributes, and library reference.
"""
from __future__ import annotations

import asyncio
import json
import logging
import subprocess
import sys
from pathlib import Path

from ai_hydro.mcp.app import mcp, Context
from ai_hydro.mcp.helpers import (
    _cached_response,
    _ensure_session,
    _get_session_geometry,
    _result_to_dict,
    _session_store,
    _strip_forcing_arrays,
    _tool_error_to_dict,
    _validate_gauge_id,
    _workspace_write,
)

log = logging.getLogger("ai_hydro.mcp")

# Script run in an isolated child process by _run_camels_extractor_subprocess.
# A crash inside CamelsExtractor.extract_all() will only kill the child, not
# the MCP server.
_CAMELS_SUBPROCESS_SCRIPT = """\
import sys, json
from camels_attrs import CamelsExtractor
gauge_id = sys.argv[1]
extractor = CamelsExtractor(gauge_id)
attrs = extractor.extract_all()
clean = {}
for k, v in attrs.items():
    try:
        clean[k] = float(v) if v is not None else None
    except (TypeError, ValueError):
        clean[k] = str(v) if v is not None else None
print(json.dumps(clean))
"""


def _run_camels_extractor_subprocess(gauge_id: str, timeout: int = 180) -> dict:
    """
    Run CamelsExtractor.extract_all() in a separate subprocess.

    extract_all() fetches data from many external APIs and has been observed to
    crash the Python process in some environments. Running it in a child process
    ensures any crash is isolated and the MCP server stays alive.

    Parameters
    ----------
    gauge_id : str
        8-digit USGS gauge identifier.
    timeout : int
        Maximum seconds to wait (default: 180 — extract_all is slow).

    Returns
    -------
    dict
        JSON-serialisable attribute mapping.

    Raises
    ------
    RuntimeError
        If the child exits non-zero or times out.
    """
    try:
        result = subprocess.run(
            [sys.executable, "-c", _CAMELS_SUBPROCESS_SCRIPT, gauge_id],
            capture_output=True,
            text=True,
            timeout=timeout,
        )
    except subprocess.TimeoutExpired:
        raise RuntimeError(
            f"CamelsExtractor timed out after {timeout}s for gauge {gauge_id}. "
            "The CAMELS attribute extraction makes many external API calls — "
            "check your network connection and try again."
        )

    if result.returncode != 0:
        stderr_snippet = result.stderr.strip()[:600]
        raise RuntimeError(
            f"CamelsExtractor subprocess exited with code {result.returncode} "
            f"for gauge {gauge_id}. stderr: {stderr_snippet}"
        )

    try:
        return json.loads(result.stdout.strip())
    except json.JSONDecodeError as exc:
        raise RuntimeError(
            f"CamelsExtractor returned non-JSON output for gauge {gauge_id}: "
            f"{result.stdout[:200]}"
        ) from exc


# ============================================================================
# Tool: Watershed Delineation
# ============================================================================

@mcp.tool()
def delineate_watershed(gauge_id: str, workspace_dir: str | None = None) -> dict:
    """
    Delineate watershed boundary for a USGS stream gauge.

    Retrieves the standardized watershed polygon from USGS NLDI and gauge
    metadata from NWIS. No separate start_session call needed — pass
    workspace_dir here and the session is created automatically.

    Parameters
    ----------
    gauge_id : str
        8-digit USGS gauge ID, e.g. '01031500'
    workspace_dir : str, optional
        Absolute path to the VS Code workspace folder. Files are saved
        here automatically. Pass once — remembered for all future tool calls.

    Returns
    -------
    dict with keys (geometry is stored in session, NOT returned here):
        data.area_km2    : Watershed drainage area in km²
        data.gauge_name  : Official station name
        data.gauge_lat   : Gauge latitude (°N)
        data.gauge_lon   : Gauge longitude (°E)
        data.huc_02      : 2-digit hydrologic unit code
        _file_saved      : Path where watershed_<gauge_id>.geojson was written
        _note            : Confirms geometry stored in session for downstream tools

    Examples
    --------
    >>> delineate_watershed('01031500', workspace_dir='/path/to/workspace')
    """
    try:
        gauge_id = _validate_gauge_id(gauge_id)
        session = _ensure_session(gauge_id, workspace_dir)
        # Cache hit — skip the expensive USGS API call
        if session.watershed is not None:
            compact = {k: v for k, v in session.watershed["data"].items()
                       if k != "geometry_geojson"}
            # Ensure GeoJSON file exists in current workspace
            geojson = session.watershed["data"].get("geometry_geojson")
            saved = None
            if geojson and session.workspace_dir:
                geojson_path = Path(session.workspace_dir) / f"watershed_{gauge_id}.geojson"
                if not geojson_path.exists():
                    saved = _workspace_write(gauge_id, f"watershed_{gauge_id}.geojson", geojson)
            return {
                "data": compact,
                "meta": session.watershed.get("meta", {}),
                "_cached": True,
                "_workspace_dir": session.workspace_dir,
                "_file_saved": saved,
                "_note": (
                    "Watershed already in session — GeoJSON on disk, "
                    "downstream tools ready. Call clear_session to recompute."
                ),
            }
        from ai_hydro.analysis.watershed import delineate_watershed as _fn
        result = _fn(gauge_id=gauge_id)
        d = _result_to_dict(result)
        # Store full result (including geometry) in session FIRST
        _session_store(gauge_id, "watershed", d)
        # Save GeoJSON file directly — geometry never needs to pass through LLM
        saved = _workspace_write(
            gauge_id,
            f"watershed_{gauge_id}.geojson",
            d["data"]["geometry_geojson"],
        )
        if saved:
            d["_file_saved"] = saved
        # Strip geometry from agent response — it's large and already on disk
        compact = {k: v for k, v in d["data"].items() if k != "geometry_geojson"}
        return {
            "data": compact,
            "meta": d.get("meta", {}),
            "_file_saved": d.get("_file_saved"),
            "_note": "geometry_geojson stored in session and saved to file. "
                     "Downstream tools (signatures, geomorphic, twi, forcing) "
                     "load it automatically — no need to pass it manually.",
        }
    except Exception as e:
        log.error("delineate_watershed failed: %s", e)
        return _tool_error_to_dict(e)


# ============================================================================
# Tool: Fetch Streamflow Data
# ============================================================================

@mcp.tool()
def fetch_streamflow_data(
    gauge_id: str,
    start_date: str,
    end_date: str,
    interval: str = "daily",
) -> dict:
    """
    Fetch USGS streamflow time series for a gauge.

    Downloads daily (or sub-daily) discharge from USGS NWIS and returns
    a JSON-serializable time series with full provenance.

    Parameters
    ----------
    gauge_id : str
        8-digit USGS gauge ID, e.g. '01031500'
    start_date : str
        Start date in YYYY-MM-DD format
    end_date : str
        End date in YYYY-MM-DD format
    interval : str
        'daily' (default) or 'hourly'

    Returns
    -------
    dict with keys:
        data.dates    : list of ISO date strings
        data.q_cms    : list of discharge values (m³/s)
        data.units    : 'm^3/s'
        data.n_days   : number of records
        data.gauge_name, gauge_lat, gauge_lon
        meta          : FAIR provenance

    Examples
    --------
    >>> fetch_streamflow_data('01031500', '2000-01-01', '2020-12-31')
    """
    try:
        gauge_id = _validate_gauge_id(gauge_id)
        # Cache-hit check — same gauge + date range + interval already computed
        from ai_hydro.session import HydroSession as _HS
        session = _HS.load(gauge_id)
        if session.streamflow is not None:
            cached_params = session.streamflow.get("meta", {}).get("params", {})
            if (cached_params.get("start_date") == start_date
                    and cached_params.get("end_date") == end_date
                    and cached_params.get("interval", "daily") == interval):
                compact = _strip_forcing_arrays(session.streamflow.get("data", {}))
                return {
                    "data": compact,
                    "meta": session.streamflow.get("meta", {}),
                    "_cached": True,
                    "_note": "Streamflow already cached. Full time series on disk.",
                }
        from ai_hydro.data.streamflow import fetch_streamflow_data as _fn
        result = _fn(gauge_id=gauge_id, start_date=start_date,
                     end_date=end_date, interval=interval)
        d = _result_to_dict(result)
        _session_store(gauge_id, "streamflow", d)
        saved = _workspace_write(gauge_id, f"streamflow_{gauge_id}.json", d["data"])
        # Strip raw arrays from response — saved to disk, not needed in context
        data = d["data"]
        q_vals = data.get("q_cms", [])
        compact = {k: v for k, v in data.items() if k not in ("dates", "q_cms")}
        if q_vals:
            valid = [v for v in q_vals if v is not None and isinstance(v, (int, float))]
            if valid:
                compact["q_mean_cms"] = round(sum(valid) / len(valid), 4)
                compact["q_max_cms"] = round(max(valid), 4)
                compact["q_min_cms"] = round(min(valid), 4)
                compact["n_missing"] = len(q_vals) - len(valid)
        return {
            "data": compact,
            "meta": d.get("meta", {}),
            "_file_saved": saved,
            "_note": (
                f"Full time series ({compact.get('n_days', '?')} records) saved to file. "
                "Raw dates/q_cms arrays stripped from response to prevent context overflow."
            ),
        }
    except Exception as e:
        log.error("fetch_streamflow_data failed: %s", e)
        return _tool_error_to_dict(e)


# ============================================================================
# Tool: Hydrological Signatures
# ============================================================================

@mcp.tool()
def extract_hydrological_signatures(
    gauge_id: str,
    start_date: str = "1989-10-01",
    end_date: str = "2009-09-30",
) -> dict:
    """
    Extract 17 CAMELS-style hydrological signatures for a USGS gauge.

    Computes flow statistics, baseflow index, runoff ratio, streamflow
    elasticity, high/low flow event characteristics, flow timing, and
    flow duration curve slope — all following CAMELS methodology.

    Watershed geometry and area are loaded automatically from the session
    (set by delineate_watershed). No need to pass geometry.

    Parameters
    ----------
    gauge_id : str
        8-digit USGS gauge ID. delineate_watershed must have been called first.
    start_date : str
        Analysis start date (default: CAMELS period 1989-10-01)
    end_date : str
        Analysis end date (default: CAMELS period 2009-09-30)

    Returns
    -------
    dict with keys in data:
        q_mean, q_std, q5, q95, q_median, baseflow_index,
        runoff_ratio, stream_elas, high_q_freq, high_q_dur,
        low_q_freq, low_q_dur, zero_q_freq, flow_variability,
        hfd_mean, half_flow_date_std, slope_fdc

    Examples
    --------
    >>> extract_hydrological_signatures('01031500')
    """
    try:
        gauge_id = _validate_gauge_id(gauge_id)
        from ai_hydro.session import HydroSession
        session = HydroSession.load(gauge_id)
        if session.signatures is not None:
            return _cached_response("signatures", session)
        watershed_geojson = _get_session_geometry(gauge_id)
        area_km2 = session.watershed["data"]["area_km2"]
        from ai_hydro.analysis.signatures import extract_hydrological_signatures as _fn
        result = _fn(
            gauge_id=gauge_id,
            watershed_geojson=watershed_geojson,
            area_km2=area_km2,
            start_date=start_date,
            end_date=end_date,
        )
        d = _result_to_dict(result)
        _session_store(gauge_id, "signatures", d)
        saved = _workspace_write(gauge_id, f"signatures_{gauge_id}.json", d["data"])
        if saved:
            d["_file_saved"] = saved
        return d
    except Exception as e:
        log.error("extract_hydrological_signatures failed: %s", e)
        return _tool_error_to_dict(e)


# ============================================================================
# Tool: Geomorphic Parameters
# ============================================================================

@mcp.tool()
def extract_geomorphic_parameters(
    gauge_id: str,
    dem_resolution: int = 30,
) -> dict:
    """
    Extract 28 geomorphic parameters for a watershed.

    Computes basin morphometry, relief characteristics, stream network
    metrics, and shape indices from a 30m DEM (py3dep).

    Watershed geometry and outlet coordinates are loaded automatically
    from the session (set by delineate_watershed). No geometry needed.

    Parameters
    ----------
    gauge_id : str
        8-digit USGS gauge ID. delineate_watershed must have been called first.
    dem_resolution : int
        DEM resolution in meters (default: 30)

    Returns
    -------
    dict with 28 parameters including:
        DA_km2, Lp_km, Lb_km, Lca_km (morphometry)
        Rff, Rc, Re, Sb, Ru (shape indices)
        H_m, HI, Rr_m_km, Rf (relief)
        Dd_km_per_km2, ... (drainage network)

    Examples
    --------
    >>> extract_geomorphic_parameters('01031500')
    """
    try:
        gauge_id = _validate_gauge_id(gauge_id)
        from ai_hydro.session import HydroSession
        session = HydroSession.load(gauge_id)
        if session.geomorphic is not None:
            return _cached_response("geomorphic", session)
        watershed_geojson = _get_session_geometry(gauge_id)
        ws_data = session.watershed["data"]
        outlet_lat = ws_data["gauge_lat"]
        outlet_lon = ws_data["gauge_lon"]
        from ai_hydro.analysis.geomorphic import extract_geomorphic_parameters_result as _fn
        result = _fn(
            watershed_geojson=watershed_geojson,
            outlet_lat=outlet_lat,
            outlet_lon=outlet_lon,
            dem_resolution=dem_resolution,
        )
        d = _result_to_dict(result)
        _session_store(gauge_id, "geomorphic", d)
        saved = _workspace_write(gauge_id, f"geomorphic_{gauge_id}.json", d["data"])
        if saved:
            d["_file_saved"] = saved
        return d
    except Exception as e:
        log.error("extract_geomorphic_parameters failed: %s", e)
        return _tool_error_to_dict(e)


# ============================================================================
# Tool: Topographic Wetness Index
# ============================================================================

@mcp.tool()
async def compute_twi(
    gauge_id: str,
    resolution: int = 30,
    create_map: bool = True,
    ctx: Context | None = None,
) -> dict:
    """
    Compute Topographic Wetness Index (TWI) for a watershed.

    TWI = ln(a / tan(beta)) quantifies the tendency of each location to
    accumulate water. Used for soil moisture mapping, saturated zone
    identification, and runoff generation analysis.

    Watershed geometry is loaded automatically from the session (set by
    delineate_watershed). No geometry needed.

    When workspace_dir is set (via delineate_watershed), saves:
    - twi_<gauge_id>.json          — statistics
    - twi_<gauge_id>.tif           — GeoTIFF raster (if create_map=True)
    - twi_<gauge_id>_map.png       — static map (if create_map=True)
    - twi_<gauge_id>_map.html      — interactive Leaflet map (if create_map=True)

    Parameters
    ----------
    gauge_id : str
        8-digit USGS gauge ID. delineate_watershed must have been called first.
    resolution : int
        DEM resolution in meters (default: 30)
    create_map : bool
        Generate PNG + interactive HTML map (default: True). Set False for
        statistics only.

    Returns
    -------
    dict with data keys:
        twi_mean, twi_median, twi_std, twi_min, twi_max,
        percent_high_twi, percent_low_twi, twi_p25, twi_p75
        files_saved: list of paths written (raster, maps, json)

    Examples
    --------
    >>> compute_twi('01031500')              # statistics + maps
    >>> compute_twi('01031500', create_map=False)  # statistics only
    """
    try:
        gauge_id = _validate_gauge_id(gauge_id)
        from ai_hydro.session import HydroSession
        session = HydroSession.load(gauge_id)
        if session.twi is not None:
            return _cached_response("twi", session)
        watershed_geojson = _get_session_geometry(gauge_id)
        workspace = session.workspace_dir
        viz_failed: str | None = None

        if ctx:
            await ctx.report_progress(progress=0, total=10)

        # Try full visualization path if workspace is known and create_map requested
        if create_map and workspace:
            try:
                # Convert GeoJSON dict -> Shapely geometry (compute_twi expects shapely/GDF)
                from shapely.geometry import shape as _shape
                watershed_shapely = _shape(watershed_geojson)
                from ai_hydro.analysis.twi import compute_twi as _fn_full

                # Run CPU-bound computation in a thread to keep event loop alive
                result = await asyncio.to_thread(
                    _fn_full,
                    watershed_shapely,
                    resolution=resolution,
                    save_outputs=True,
                    output_dir=workspace,
                    output_prefix=f"twi_{gauge_id}",
                    create_visualizations=True,
                )

                if ctx:
                    await ctx.report_progress(progress=10, total=10)

                # Use files_saved list built by compute_twi()
                files = result.get("files_saved", [])
                # Strip large arrays (numpy) but keep scalar stats + files_saved
                _EXCLUDE = {"twi_array", "well_drained_mask", "moderate_mask", "saturated_mask"}
                stats = {k: v for k, v in result.items() if k not in _EXCLUDE}
                d = {"data": {**stats, "files_saved": files},
                     "meta": {"tool": "ai_hydro.analysis.twi.compute_twi",
                               "params": {"resolution": resolution,
                                          "create_map": create_map}}}
                _session_store(gauge_id, "twi", d)
                d["_files_saved"] = files
                return d
            except Exception as viz_err:
                log.warning("TWI full computation failed, falling back to stats only: %s", viz_err)
                viz_failed = str(viz_err)

        # Fallback: statistics only (when workspace missing, create_map=False,
        # or full computation raised a fatal error)
        from ai_hydro.analysis.twi import compute_twi_result as _fn
        result = await asyncio.to_thread(
            _fn, watershed_geojson=watershed_geojson, resolution=resolution
        )
        d = _result_to_dict(result)
        _session_store(gauge_id, "twi", d)
        saved = _workspace_write(gauge_id, f"twi_{gauge_id}.json", d["data"])
        if saved:
            d["_file_saved"] = saved
        if viz_failed:
            d["_visualization_warning"] = (
                f"Map generation failed: {viz_failed[:300]}. "
                "Statistics saved successfully. Use create_map=False to suppress."
            )

        if ctx:
            await ctx.report_progress(progress=10, total=10)

        return d
    except Exception as e:
        log.error("compute_twi failed: %s", e)
        return _tool_error_to_dict(e)


# ============================================================================
# Tool: Curve Number Grid
# ============================================================================

@mcp.tool()
async def create_cn_grid(
    gauge_id: str,
    year: int = 2019,
    resolution: int = 30,
    create_map: bool = True,
    ctx: Context | None = None,
) -> dict:
    """Create an NRCS Curve Number grid for the watershed.

    Combines NLCD land cover with Polaris soil properties to produce
    a spatially distributed CN grid.  Requires watershed to be delineated
    first (run delineate_watershed).

    Returns CN statistics, zone percentages, LULC + soil breakdowns,
    and saves GeoTIFF / NetCDF / PNG / HTML to the workspace.
    """
    try:
        gauge_id = _validate_gauge_id(gauge_id)
        session = _ensure_session(gauge_id)

        # Cache hit
        if session.cn is not None:
            cached = session.cn
            return {
                "data": cached.get("data", {}),
                "meta": cached.get("meta", {}),
                "_cached": True,
                "_workspace_dir": session.workspace_dir,
            }

        # Need watershed geometry
        watershed_geojson = _get_session_geometry(gauge_id)
        workspace = session.workspace_dir or str(Path.home() / ".aihydro" / "cache")

        if ctx:
            await ctx.report_progress(progress=0, total=7)

        from shapely.geometry import shape as _shape
        from ai_hydro.analysis.curve_number import (
            create_curve_number_grid_from_geometry as _fn,
        )

        watershed_shapely = _shape(watershed_geojson)
        output_dir = str(Path(workspace) / f"cn_grid_{gauge_id}")

        result = await asyncio.to_thread(
            _fn,
            geometry=watershed_shapely,
            year=year,
            resolution=resolution,
            save_outputs=True,
            output_dir=output_dir,
            create_visualizations=create_map,
            output_prefix=f"cn_{gauge_id}",
        )

        if ctx:
            await ctx.report_progress(progress=7, total=7)

        # Filter: exclude xarray DataArray, GeoDataFrame, shapely geom, matplotlib figure
        stats = result.get("statistics", {})
        zones = result.get("cn_zones", {})
        lulc = result.get("lulc_stats", {})
        soil = result.get("soil_stats", {})
        file_paths = result.get("file_paths", {})
        ws_info = result.get("watershed_info", {})

        data = {
            **stats,
            **zones,
            "lulc_classes": lulc.get("classes", []),
            "soil_group_percentages": soil.get("soil_group_percentages", {}),
            "area_km2": ws_info.get("area_km2"),
            "files_saved": list(file_paths.values()),
        }

        d = {
            "data": data,
            "meta": {
                "tool": "ai_hydro.analysis.curve_number.create_curve_number_grid_from_geometry",
                "params": {"year": year, "resolution": resolution, "create_map": create_map},
            },
        }
        _session_store(gauge_id, "cn", d)
        d["_files_saved"] = list(file_paths.values())
        return d

    except Exception as e:
        log.error("create_cn_grid failed: %s", e)
        return _tool_error_to_dict(e)


# ============================================================================
# Tool: Forcing Data
# ============================================================================

@mcp.tool()
async def fetch_forcing_data(
    gauge_id: str,
    start_date: str,
    end_date: str,
    variables: list[str] | None = None,
    ctx: Context | None = None,
) -> dict:
    """
    Fetch basin-averaged daily forcing data from GridMET.

    Retrieves precipitation, temperature, wind, humidity, and solar
    radiation for a watershed. Essential for hydrological modelling input.

    Watershed geometry is loaded automatically from the session (set by
    delineate_watershed). No geometry needed.

    Parameters
    ----------
    gauge_id : str
        8-digit USGS gauge ID. delineate_watershed must have been called first.
    start_date : str
        Start date YYYY-MM-DD
    end_date : str
        End date YYYY-MM-DD
    variables : list[str], optional
        Subset of GridMET variables. Default: all available.
        Options: pr, tmmx, tmmn, srad, vs, rmax, rmin, pet, erc

    Returns
    -------
    dict with data keys:
        dates       : list of ISO date strings
        <var>       : list of daily values for each requested variable
        units       : dict mapping variable -> unit string
        n_days      : number of records

    Examples
    --------
    >>> fetch_forcing_data('01031500', '2000-01-01', '2010-12-31')
    """
    try:
        gauge_id = _validate_gauge_id(gauge_id)
        # Cache-hit check — same gauge + date range already computed
        from ai_hydro.session import HydroSession as _HS2
        session = _HS2.load(gauge_id)
        if session.forcing is not None:
            cached_params = session.forcing.get("meta", {}).get("params", {})
            if (cached_params.get("start_date") == start_date
                    and cached_params.get("end_date") == end_date):
                compact = _strip_forcing_arrays(session.forcing.get("data", {}))
                return {
                    "data": compact,
                    "meta": session.forcing.get("meta", {}),
                    "_cached": True,
                    "_note": "Forcing data already cached. Full daily arrays on disk.",
                }
        watershed_geojson = _get_session_geometry(gauge_id)
        from ai_hydro.data.forcing import fetch_forcing_data_result as _fn

        if ctx:
            await ctx.report_progress(progress=0, total=2)

        # Run the network-bound GridMET download in a thread
        result = await asyncio.to_thread(
            _fn,
            watershed_geojson=watershed_geojson,
            start_date=start_date,
            end_date=end_date,
            variables=variables,
        )

        if ctx:
            await ctx.report_progress(progress=2, total=2)

        d = _result_to_dict(result)
        _session_store(gauge_id, "forcing", d)
        saved = _workspace_write(gauge_id, f"forcing_{gauge_id}.json", d["data"])
        # Strip large daily arrays — saved to disk, not needed in context
        compact = _strip_forcing_arrays(d["data"])
        return {
            "data": compact,
            "meta": d.get("meta", {}),
            "_file_saved": saved,
            "_note": (
                f"Forcing data ({compact.get('n_days', '?')} records, "
                f"{compact.get('n_variables', '?')} variables) saved to file. "
                "Raw daily arrays stripped from response to prevent context overflow."
            ),
        }
    except Exception as e:
        log.error("fetch_forcing_data failed: %s", e)
        return _tool_error_to_dict(e)


# ============================================================================
# Tool: CAMELS Attributes (via camels-attrs package)
# ============================================================================

@mcp.tool()
def extract_camels_attributes(gauge_id: str) -> dict:
    """
    Extract 60+ CAMELS-style catchment attributes for a USGS gauge.

    Retrieves topographic, climate, soil, vegetation, geological, and
    hydrological attributes following the CAMELS dataset methodology.
    Uses the camels-attrs package (pip install camels-attrs).

    Parameters
    ----------
    gauge_id : str
        8-digit USGS gauge ID, e.g. '01031500'

    Returns
    -------
    dict with 60+ attributes across categories:
        Topographic (7): elev_mean, slope_mean, area_gages2, ...
        Climate (13): p_mean, pet_mean, aridity, frac_snow, ...
        Soil (9): soil_depth, soil_porosity, soil_conductivity, ...
        Vegetation (13): frac_forest, lai_max, gvf_max, ...
        Geological (7): geol_permeability, carbonate_rocks_frac, ...
        Hydrological (17): q_mean, baseflow_index, runoff_ratio, ...

    Examples
    --------
    >>> extract_camels_attributes('01031500')
    >>> extract_camels_attributes('09380000')  # Colorado River

    Notes
    -----
    Requires: pip install camels-attrs
    See: https://github.com/AI-Hydro/camels-attrs
    """
    # Check package availability before spawning subprocess for a friendlier message.
    try:
        import camels_attrs as _camels_check  # noqa: F401
    except ImportError:
        return {
            "error": True,
            "code": "DEPENDENCY_ERROR",
            "message": "camels-attrs package not installed.",
            "recovery": "pip install camels-attrs",
            "tool": "camels_attrs.CamelsExtractor",
        }

    try:
        gauge_id = _validate_gauge_id(gauge_id)
        from ai_hydro.session import HydroSession as _HS3
        _sess = _HS3.load(gauge_id)
        if _sess.camels is not None:
            return _cached_response("camels", _sess)
        from ai_hydro.core import HydroResult, HydroMeta, DataSource
        from ai_hydro.mcp.tools_docs import _get_camels_attrs_version

        # Run in isolated subprocess — extract_all() can crash the process
        # on some environments; a child crash won't kill the MCP server.
        clean = _run_camels_extractor_subprocess(gauge_id)

        result = HydroResult(
            data=clean,
            meta=HydroMeta(
                tool="camels_attrs.CamelsExtractor.extract_all",
                version=_get_camels_attrs_version(),
                gauge_id=gauge_id,
                sources=[
                    DataSource(
                        name="USGS NLDI / NWIS / GridMET / STATSGO / MODIS / GLHYMPS",
                        url="https://github.com/AI-Hydro/camels-attrs",
                        citation=(
                            "@article{Addor2017,\n"
                            "  title={The CAMELS data set: catchment attributes and "
                            "meteorology for large-sample studies},\n"
                            "  author={Addor, Nans and Newman, Andrew J and "
                            "Mizukami, Naoki and Clark, Martyn P},\n"
                            "  journal={Hydrology and Earth System Sciences},\n"
                            "  volume={21}, number={10}, pages={5293--5313}, year={2017}\n"
                            "}"
                        ),
                    )
                ],
                params={"gauge_id": gauge_id},
            ),
        )
        d = _result_to_dict(result)
        _session_store(gauge_id, "camels", d)
        saved = _workspace_write(gauge_id, f"camels_{gauge_id}.json", d["data"])
        if saved:
            d["_file_saved"] = saved
        return d

    except Exception as e:
        log.error("extract_camels_attributes failed: %s", e)
        return _tool_error_to_dict(e)


# ============================================================================
# Tool: Library Reference (gotchas, field mappings, code patterns)
# ============================================================================

@mcp.tool()
def get_library_reference(library: str) -> dict:
    """
    Look up field-name gotchas, API quirks, and copy-paste patterns for a
    core hydrological Python library.

    Use this before writing Python scripts that use one of the supported
    libraries — it prevents the most common hallucination mistakes (wrong
    field names, wrong CRS, wrong unit assumptions).

    Supported libraries
    -------------------
    pynhd       — NLDI watershed polygons and NHD data
    pygeohydro  — USGS NWIS streamflow and NLCD land cover
    pygridmet   — GridMET daily climate (precipitation, temperature)
    py3dep      — 3DEP elevation (DEM) access
    hydrofunctions — simple NWIS streamflow client
    pysheds     — DEM-based flow direction, accumulation, TWI
    rasterio    — raster I/O, masking, reprojection
    xarray      — N-dimensional labeled arrays for gridded data

    Parameters
    ----------
    library : str
        Library name (case-insensitive). One of the supported libraries above.

    Returns
    -------
    dict with keys:
        library         : canonical library name
        purpose         : one-line description
        field_mappings  : dict of function → field name notes
        gotchas         : list of common mistakes to avoid
        common_patterns : dict of task → copy-paste code snippet
        available_refs  : list of all libraries with references (if not found)
    """
    try:
        from ai_hydro.knowledge import get_library_ref, list_library_refs
        ref = get_library_ref(library)
        if ref is None:
            return {
                "error": True,
                "code": "NOT_FOUND",
                "message": f"No reference available for '{library}'.",
                "available_refs": list_library_refs(),
            }
        return ref
    except Exception as e:
        log.error("get_library_reference failed: %s", e)
        return _tool_error_to_dict(e)
