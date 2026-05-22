"""
Analysis MCP tools (9 tools).

Watershed delineation, streamflow, signatures, geomorphic parameters,
TWI, curve number grid, forcing data, CAMELS-US attributes, and library reference.

Tool parameter conventions
--------------------------
session_id : str
    Research session identity — any string (slug, UUID, gauge ID used as a
    shorthand, or anything meaningful to the study). Keyed in HydroSession.
    Auto-generated "hydro-<8hex>" if not supplied.

gauge_id : str  (USGS-specific data tools only)
    8-digit USGS station number, e.g. '01031500'. Only required by tools that
    fetch data from USGS NWIS / NLDI (delineate_watershed, fetch_streamflow_data).
    After the first USGS call the gauge ID is stored in session.site_id so
    subsequent tools can resolve it automatically.

Source-agnostic analysis tools (extract_hydrological_signatures,
extract_geomorphic_parameters, compute_twi, create_cn_grid, fetch_forcing_data)
have NO gauge_id parameter — they work on session geometry and time-series data
regardless of where that data came from.
"""
from __future__ import annotations

import asyncio
import json
import logging
from pathlib import Path

from ai_hydro.mcp.app import mcp, Context
from ai_hydro.mcp.helpers import (
    _cached_response,
    _ensure_session,
    _get_session_geometry,
    _normalize_session_id,
    _result_to_dict,
    _session_store,
    _strip_forcing_arrays,
    _sync_reminder,
    _tool_error_to_dict,
    _validate_usgs_gauge_id,
    _workspace_write,
)

log = logging.getLogger("ai_hydro.mcp")


def _bounds_to_wgs84(bounds: list, crs_str: str) -> list:
    """
    Convert [west, south, east, north] bounds to EPSG:4326 if needed.
    Falls back to returning bounds unchanged if pyproj is unavailable or
    CRS is already geographic.
    """
    try:
        from pyproj import CRS, Transformer
        src_crs = CRS.from_user_input(crs_str or "EPSG:4326")
        if src_crs.is_geographic:
            return bounds  # already lat/lon
        wgs84 = CRS.from_epsg(4326)
        transformer = Transformer.from_crs(src_crs, wgs84, always_xy=True)
        west, south = transformer.transform(bounds[0], bounds[1])
        east, north = transformer.transform(bounds[2], bounds[3])
        return [west, south, east, north]
    except Exception:
        return bounds  # best-effort fallback


def _resolve_usgs_gauge(session_id: str, gauge_id: str | None, session) -> str:
    """
    Resolve the 8-digit USGS station number for a session.

    Resolution order:
    1. ``gauge_id`` parameter (explicit)
    2. ``session.site_id`` (set by a previous USGS tool call)
    3. ``session_id`` itself, if it passes USGS format validation (backward compat)

    Raises ValueError with a clear recovery message if none of the above work.
    """
    if gauge_id:
        return _validate_usgs_gauge_id(gauge_id)
    if session.site_id:
        try:
            return _validate_usgs_gauge_id(session.site_id)
        except ValueError:
            pass
    # Backward compat: if the caller used the gauge ID as session_id
    try:
        return _validate_usgs_gauge_id(session_id)
    except ValueError:
        pass
    raise ValueError(
        f"No USGS gauge_id found for session '{session_id}'. "
        "Pass gauge_id='01031500' (8-digit USGS station number) explicitly. "
        "Find gauge IDs at https://waterdata.usgs.gov/"
    )


# ============================================================================
# Tool: Watershed Delineation
# ============================================================================

@mcp.tool()
def delineate_watershed(
    session_id: str,
    gauge_id: str | None = None,
    workspace_dir: str | None = None,
) -> dict:
    """
    Delineate watershed boundary for a USGS stream gauge.

    Retrieves the standardized watershed polygon from USGS NLDI and gauge
    metadata from NWIS. After delineation the gauge ID is stored in
    session.site_id so downstream tools (signatures, geomorphic, TWI)
    resolve it automatically.

    Parameters
    ----------
    session_id : str
        Research session identifier — any string (slug, UUID, basin name,
        or gauge ID used as shorthand). Created automatically if new.
    gauge_id : str, optional
        8-digit USGS station number, e.g. '01031500'. If omitted the tool
        checks session.site_id set by a previous call. At least one must
        resolve to a valid USGS ID.
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
    >>> delineate_watershed('piscataquis-2020', gauge_id='01031500',
    ...                     workspace_dir='/path/to/workspace')
    >>> delineate_watershed('01031500')  # gauge ID as session_id (backward compat)
    """
    try:
        session_id = _normalize_session_id(session_id)
        session = _ensure_session(session_id, workspace_dir)
        resolved_gauge_id = _resolve_usgs_gauge(session_id, gauge_id, session)

        # Cache hit — skip the expensive USGS API call
        if session.watershed is not None:
            ws_data = session.watershed["data"]
            compact = {k: v for k, v in ws_data.items() if k != "geometry_geojson"}
            files_saved: list[str] = []
            # Ensure workspace copy exists; try path-ref first, then legacy inline geojson
            geojson_path_on_disk = ws_data.get("geometry_geojson_path")
            geojson = None
            if geojson_path_on_disk and Path(geojson_path_on_disk).exists():
                with open(geojson_path_on_disk) as _f:
                    geojson = json.load(_f)
            else:
                geojson = ws_data.get("geometry_geojson")
            if geojson and session.workspace_dir:
                ws_geojson = (
                    Path(session.workspace_dir) / f"watershed_{resolved_gauge_id}.geojson"
                )
                if not ws_geojson.exists():
                    saved = _workspace_write(
                        session_id, f"watershed_{resolved_gauge_id}.geojson", geojson
                    )
                    if saved:
                        files_saved.append(saved)
            return {
                "data": compact,
                "meta": session.watershed.get("meta", {}),
                "_cached": True,
                "_workspace_dir": session.workspace_dir,
                "_files_saved": files_saved or None,
                "_note": (
                    "Watershed already in session — GeoJSON on disk, "
                    "downstream tools ready. Call clear_session to recompute."
                ),
            }

        from ai_hydro.analysis.watershed import delineate_watershed as _fn
        result = _fn(gauge_id=resolved_gauge_id)
        d = _result_to_dict(result)
        geojson = d["data"]["geometry_geojson"]
        files_saved = []

        # Always save geometry to ~/.aihydro/sessions/<session_id>.geojson so the
        # path is stable and independent of workspace_dir. This keeps the session
        # JSON lean (stores a path, not 200-800 KB of coordinates).
        from ai_hydro.session.store import _SESSIONS_DIR
        sessions_geojson = _SESSIONS_DIR / f"{session_id}.geojson"
        _SESSIONS_DIR.mkdir(parents=True, exist_ok=True)
        with open(sessions_geojson, "w") as _f:
            json.dump(geojson, _f)
        files_saved.append(str(sessions_geojson))

        # Replace full geojson with path reference in session slot
        d_lean = dict(d)
        d_lean["data"] = {
            **{k: v for k, v in d["data"].items() if k != "geometry_geojson"},
            "geometry_geojson_path": str(sessions_geojson),
        }
        _session_store(session_id, "watershed", d_lean, tool_name="delineate_watershed")

        # Persist gauge metadata in session so downstream tools don't need gauge_id
        from ai_hydro.session import HydroSession
        _sess_upd = HydroSession.load(session_id)
        if not _sess_upd.site_id:
            _sess_upd.site_id = resolved_gauge_id
            _sess_upd.site_type = "usgs_gauge"
            _sess_upd.save()

        # Also write to workspace for user-visible copy
        ws = session.workspace_dir or workspace_dir
        if ws:
            saved = _workspace_write(
                session_id, f"watershed_{resolved_gauge_id}.geojson", geojson
            )
            if saved:
                files_saved.append(saved)
            # Watershed boundary map PNG
            from ai_hydro.analysis.plots import plot_watershed_map
            png = plot_watershed_map(
                geojson=geojson,
                gauge_lat=d["data"].get("gauge_lat", 0.0),
                gauge_lon=d["data"].get("gauge_lon", 0.0),
                gauge_name=d["data"].get("gauge_name", ""),
                output_dir=ws,
                gauge_id=resolved_gauge_id,
            )
            if png:
                files_saved.append(png)

        # Push watershed boundary to map panel (non-fatal if VS Code not open)
        from ai_hydro.mcp.map_events import push_layer, push_gauge_point
        geojson_for_map = geojson if geojson else {}
        ws_rel = f"watershed_{resolved_gauge_id}.geojson"
        if session.workspace_dir:
            from ai_hydro.session import HydroSession
            _sess_geom = HydroSession.load(session_id)
            _sess_geom.working_geometry_path = ws_rel
            _sess_geom.save()
        push_layer(
            layer_id=f"watershed_{resolved_gauge_id}",
            name=f"Watershed: {d['data'].get('gauge_name', resolved_gauge_id)}",
            geojson=geojson_for_map,
            layer_type="polygon",
            style_preset="watershed",
            auto_zoom=True,
            open_map=True,
            metadata={
                "gauge_id": resolved_gauge_id,
                "area_km2": str(round(d["data"].get("area_km2", 0), 1)),
                "source": "USGS NLDI",
            },
        )
        lat = d["data"].get("gauge_lat")
        lon = d["data"].get("gauge_lon")
        if lat is not None and lon is not None:
            push_gauge_point(
                layer_id=f"gauge_{resolved_gauge_id}",
                name=f"Gauge: {d['data'].get('gauge_name', resolved_gauge_id)}",
                lat=lat,
                lon=lon,
                metadata={"gauge_id": resolved_gauge_id, "source": "USGS NWIS"},
            )

        # Strip geometry from agent response — it's large and already on disk
        compact = {k: v for k, v in d["data"].items() if k != "geometry_geojson"}
        resp: dict = {
            "data": compact,
            "meta": d.get("meta", {}),
            "_files_saved": files_saved,
            "_note": (
                f"geometry_geojson saved to file (not in session JSON). "
                f"gauge_id '{resolved_gauge_id}' stored in session.site_id. "
                "Downstream tools (signatures, geomorphic, twi, forcing) "
                "load it automatically — no need to pass gauge_id again. "
                "Watershed boundary and gauge point pushed to AI-Hydro map."
            ),
        }
        reminder = _sync_reminder(session_id)
        if reminder:
            resp["_sync_required"] = reminder
        return resp
    except Exception as e:
        log.error("delineate_watershed failed: %s", e)
        return _tool_error_to_dict(e)


# ============================================================================
# Tool: Fetch Streamflow Data
# ============================================================================

@mcp.tool()
def fetch_streamflow_data(
    session_id: str,
    gauge_id: str | None = None,
    start_date: str = "",
    end_date: str = "",
    interval: str = "daily",
) -> dict:
    """
    Fetch USGS streamflow time series for a gauge.

    Downloads daily (or sub-daily) discharge from USGS NWIS and returns
    a JSON-serializable time series with full provenance.

    Parameters
    ----------
    session_id : str
        Research session identifier. Must match the session used in
        delineate_watershed so results are co-located.
    gauge_id : str, optional
        8-digit USGS station number, e.g. '01031500'. Resolved automatically
        from session.site_id if omitted (set by delineate_watershed).
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
    >>> fetch_streamflow_data('piscataquis-2020', gauge_id='01031500',
    ...                       start_date='2000-01-01', end_date='2020-12-31')
    >>> fetch_streamflow_data('01031500', '2000-01-01', '2020-12-31')
    """
    try:
        session_id = _normalize_session_id(session_id)
        from ai_hydro.session import HydroSession as _HS
        session = _HS.load(session_id)
        resolved_gauge_id = _resolve_usgs_gauge(session_id, gauge_id, session)

        # Cache-hit check — same gauge + date range + interval already computed
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
        result = _fn(
            gauge_id=resolved_gauge_id,
            start_date=start_date,
            end_date=end_date,
            interval=interval,
        )
        d = _result_to_dict(result)

        # Persist gauge metadata if not already set
        if not session.site_id:
            session.site_id = resolved_gauge_id
            session.site_type = "usgs_gauge"
            session.save()

        files_saved: list[str] = []
        saved = _workspace_write(
            session_id, f"streamflow_{resolved_gauge_id}.json", d["data"]
        )
        if saved:
            files_saved.append(saved)

        # Record the data file path in the slot so downstream tools (FDC plot,
        # model training) can reload raw arrays without re-fetching from USGS.
        if saved:
            d["data"]["_data_file"] = saved
        _session_store(session_id, "streamflow", d, tool_name="fetch_streamflow_data")

        # Strip raw arrays from response — saved to disk, not needed in context
        data = d["data"]
        q_vals = data.get("q_cms", [])
        compact = {k: v for k, v in data.items()
                   if k not in ("dates", "q_cms") and not k.startswith("_")}
        if q_vals:
            valid = [v for v in q_vals if v is not None and isinstance(v, (int, float))]
            if valid:
                compact["q_mean_cms"] = round(sum(valid) / len(valid), 4)
                compact["q_max_cms"] = round(max(valid), 4)
                compact["q_min_cms"] = round(min(valid), 4)
                compact["n_missing"] = len(q_vals) - len(valid)
        if saved:
            compact["_data_file"] = saved

        # Hydrograph PNG
        ws = session.workspace_dir
        if ws and data.get("dates") and q_vals:
            from ai_hydro.analysis.plots import plot_hydrograph
            png = plot_hydrograph(
                dates=data["dates"],
                q_cms=q_vals,
                gauge_name=data.get("gauge_name", ""),
                gauge_id=resolved_gauge_id,
                output_dir=ws,
            )
            if png:
                files_saved.append(png)

        resp: dict = {
            "data": compact,
            "meta": d.get("meta", {}),
            "_files_saved": files_saved,
            "_note": (
                f"Full time series ({compact.get('n_days', '?')} records) saved to "
                f"{saved or 'session'}. Raw dates/q_cms arrays are NOT in the session JSON "
                "or this response — load from _data_file when needed."
            ),
        }
        reminder = _sync_reminder(session_id)
        if reminder:
            resp["_sync_required"] = reminder
        return resp
    except Exception as e:
        log.error("fetch_streamflow_data failed: %s", e)
        return _tool_error_to_dict(e)


# ============================================================================
# Tool: Hydrological Signatures
# ============================================================================

@mcp.tool()
def extract_hydrological_signatures(
    session_id: str,
    start_date: str = "1989-10-01",
    end_date: str = "2009-09-30",
) -> dict:
    """
    Extract 17 CAMELS-style hydrological signatures from a session's streamflow.

    Computes flow statistics, baseflow index, runoff ratio, streamflow
    elasticity, high/low flow event characteristics, flow timing, and
    flow duration curve slope — all following CAMELS methodology.

    Watershed geometry and area are loaded automatically from the session
    (set by delineate_watershed). For USGS gauges the USGS station number
    is resolved from session.site_id.

    Parameters
    ----------
    session_id : str
        Research session identifier. delineate_watershed must have been
        called for this session first.
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
    >>> extract_hydrological_signatures('piscataquis-2020')
    """
    try:
        session_id = _normalize_session_id(session_id)
        from ai_hydro.session import HydroSession
        session = HydroSession.load(session_id)
        if session.signatures is not None:
            return _cached_response("signatures", session)
        watershed_geojson = _get_session_geometry(session_id)
        area_km2 = session.watershed["data"]["area_km2"]
        # The underlying function fetches streamflow from USGS NWIS if not cached;
        # resolve gauge_id from session.site_id for USGS gauges.
        usgs_gauge_id = session.site_id or session_id
        from ai_hydro.analysis.signatures import extract_hydrological_signatures as _fn
        result = _fn(
            gauge_id=usgs_gauge_id,
            watershed_geojson=watershed_geojson,
            area_km2=area_km2,
            start_date=start_date,
            end_date=end_date,
        )
        d = _result_to_dict(result)
        _session_store(session_id, "signatures", d, tool_name="extract_hydrological_signatures")
        files_saved: list[str] = []
        saved = _workspace_write(
            session_id, f"signatures_{session_id}.json", d["data"]
        )
        if saved:
            files_saved.append(saved)
        # FDC + signature summary PNG
        # q_cms may have been stripped from the session JSON (lean storage);
        # try reloading from the on-disk data file recorded during streamflow fetch.
        ws = session.workspace_dir
        if ws and session.streamflow:
            q_vals = session.streamflow.get("data", {}).get("q_cms")
            if not q_vals:
                data_file = session.streamflow.get("data", {}).get("_data_file")
                if data_file and Path(data_file).exists():
                    try:
                        import json as _json
                        with open(data_file) as _f:
                            q_vals = _json.load(_f).get("q_cms")
                    except Exception:
                        q_vals = None
            if q_vals:
                from ai_hydro.analysis.plots import plot_flow_duration_curve
                png = plot_flow_duration_curve(
                    q_cms=q_vals,
                    signatures=d["data"],
                    gauge_id=session_id,
                    output_dir=ws,
                )
                if png:
                    files_saved.append(png)
        d["_files_saved"] = files_saved
        reminder = _sync_reminder(session_id)
        if reminder:
            d["_sync_required"] = reminder
        return d
    except Exception as e:
        log.error("extract_hydrological_signatures failed: %s", e)
        return _tool_error_to_dict(e)


# ============================================================================
# Tool: Geomorphic Parameters
# ============================================================================

@mcp.tool()
def extract_geomorphic_parameters(
    session_id: str,
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
    session_id : str
        Research session identifier. delineate_watershed must have been
        called for this session first.
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
    >>> extract_geomorphic_parameters('piscataquis-2020')
    """
    try:
        session_id = _normalize_session_id(session_id)
        from ai_hydro.session import HydroSession
        session = HydroSession.load(session_id)
        if session.geomorphic is not None:
            return _cached_response("geomorphic", session)
        watershed_geojson = _get_session_geometry(session_id)
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
        _session_store(session_id, "geomorphic", d, tool_name="extract_geomorphic_parameters")
        saved = _workspace_write(
            session_id, f"geomorphic_{session_id}.json", d["data"]
        )
        if saved:
            d["_file_saved"] = saved
        reminder = _sync_reminder(session_id)
        if reminder:
            d["_sync_required"] = reminder
        return d
    except Exception as e:
        log.error("extract_geomorphic_parameters failed: %s", e)
        return _tool_error_to_dict(e)


# ============================================================================
# Tool: Topographic Wetness Index
# ============================================================================

@mcp.tool()
async def compute_twi(
    session_id: str,
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
    - twi_<session_id>.json          — statistics
    - twi_<session_id>.tif           — GeoTIFF raster (if create_map=True)
    - twi_<session_id>_map.png       — static map (if create_map=True)
    - twi_<session_id>_map.html      — interactive Leaflet map (if create_map=True)

    Parameters
    ----------
    session_id : str
        Research session identifier. delineate_watershed must have been
        called for this session first.
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
    >>> compute_twi('piscataquis-2020')
    >>> compute_twi('piscataquis-2020', create_map=False)
    """
    try:
        session_id = _normalize_session_id(session_id)
        from ai_hydro.session import HydroSession
        session = HydroSession.load(session_id)
        if session.twi is not None:
            return _cached_response("twi", session)
        watershed_geojson = _get_session_geometry(session_id)
        workspace = session.workspace_dir
        viz_failed: str | None = None

        if ctx:
            await ctx.report_progress(progress=0, total=10)

        # Try full visualization path if workspace is known and create_map requested
        if create_map and workspace:
            try:
                from shapely.geometry import shape as _shape
                watershed_shapely = _shape(watershed_geojson)
                from ai_hydro.analysis.twi import compute_twi as _fn_full

                result = await asyncio.to_thread(
                    _fn_full,
                    watershed_shapely,
                    resolution=resolution,
                    save_outputs=True,
                    output_dir=workspace,
                    output_prefix=f"twi_{session_id}",
                    create_visualizations=True,
                )

                if ctx:
                    await ctx.report_progress(progress=10, total=10)

                files = result.get("files_saved", [])
                _EXCLUDE = {"twi_array", "well_drained_mask", "moderate_mask", "saturated_mask"}
                stats = {k: v for k, v in result.items() if k not in _EXCLUDE}
                d = {
                    "data": {**stats, "files_saved": files},
                    "meta": {
                        "tool": "ai_hydro.analysis.twi.compute_twi",
                        "params": {"resolution": resolution, "create_map": create_map},
                    },
                }
                _session_store(session_id, "twi", d, tool_name="compute_twi")
                d["_files_saved"] = files

                # Push raster tile to map panel if TWI array + bounds are available
                try:
                    from ai_hydro.mcp.map_events import push_raster_layer
                    from ai_hydro.analysis.plots import plot_raster_tile
                    twi_arr = result.get("twi_array")
                    raw_bounds = result.get("bounds")  # native CRS bounds from rioxarray
                    # Convert bounds to WGS84 if needed
                    raw_crs = result.get("crs", "")
                    if twi_arr is not None and raw_bounds is not None:
                        bounds_wgs84 = _bounds_to_wgs84(raw_bounds, raw_crs)
                        tile_result = plot_raster_tile(
                            array=twi_arr,
                            bounds_wgs84=bounds_wgs84,
                            output_dir=workspace,
                            name=f"twi_{session_id}",
                            colormap="viridis_r",
                        )
                        if tile_result:
                            tile_path, tile_bounds = tile_result
                            push_raster_layer(
                                layer_id=f"twi_{session_id}",
                                name=f"TWI: {session_id}",
                                png_path=tile_path,
                                bounds_wgs84=tile_bounds,
                                colormap="viridis_r",
                                opacity=0.70,
                                auto_zoom=False,
                                metadata={"session_id": session_id, "source": "pysheds + py3dep"},
                            )
                except Exception as _map_err:
                    log.debug("TWI map push failed (non-fatal): %s", _map_err)

                reminder = _sync_reminder(session_id)
                if reminder:
                    d["_sync_required"] = reminder
                return d
            except Exception as viz_err:
                log.warning(
                    "TWI full computation failed, falling back to stats only: %s", viz_err
                )
                viz_failed = str(viz_err)

        # Fallback: statistics only (workspace missing, create_map=False,
        # or full computation raised a fatal error)
        from ai_hydro.analysis.twi import compute_twi_result as _fn
        result = await asyncio.to_thread(
            _fn, watershed_geojson=watershed_geojson, resolution=resolution
        )
        d = _result_to_dict(result)
        _session_store(session_id, "twi", d, tool_name="compute_twi")
        saved = _workspace_write(session_id, f"twi_{session_id}.json", d["data"])
        if saved:
            d["_file_saved"] = saved
        if not workspace:
            d["_note"] = (
                "No workspace directory set — statistics only, no map files saved. "
                "Call delineate_watershed(session_id, workspace_dir=<path>) to enable file output."
            )
        elif viz_failed:
            d["_visualization_warning"] = (
                f"Full TWI computation failed ({viz_failed[:200]}); "
                "statistics computed via fallback. No map files generated."
            )

        reminder = _sync_reminder(session_id)
        if reminder:
            d["_sync_required"] = reminder

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
    session_id: str,
    year: int = 2019,
    resolution: int = 30,
    create_map: bool = True,
    ctx: Context | None = None,
) -> dict:
    """Create an NRCS Curve Number grid for the watershed.

    Combines NLCD land cover with Polaris soil properties to produce
    a spatially distributed CN grid. Requires watershed to be delineated
    first (run delineate_watershed).

    Returns CN statistics, zone percentages, LULC + soil breakdowns,
    and saves GeoTIFF / NetCDF / PNG / HTML to the workspace.

    Parameters
    ----------
    session_id : str
        Research session identifier. delineate_watershed must have been
        called for this session first.
    year : int
        NLCD land cover year (default: 2019)
    resolution : int
        Grid resolution in meters (default: 30)
    create_map : bool
        Generate PNG + interactive HTML map (default: True)
    """
    try:
        session_id = _normalize_session_id(session_id)
        session = _ensure_session(session_id)

        # Cache hit
        if session.cn is not None:
            cached = session.cn
            return {
                "data": cached.get("data", {}),
                "meta": cached.get("meta", {}),
                "_cached": True,
                "_workspace_dir": session.workspace_dir,
            }

        watershed_geojson = _get_session_geometry(session_id)
        workspace = session.workspace_dir or str(Path.home() / ".aihydro" / "cache")

        if ctx:
            await ctx.report_progress(progress=0, total=7)

        from shapely.geometry import shape as _shape
        from ai_hydro.analysis.curve_number import (
            create_curve_number_grid_from_geometry as _fn,
        )

        watershed_shapely = _shape(watershed_geojson)
        output_dir = str(Path(workspace) / f"cn_grid_{session_id}")

        result = await asyncio.to_thread(
            _fn,
            geometry=watershed_shapely,
            year=year,
            resolution=resolution,
            save_outputs=True,
            output_dir=output_dir,
            create_visualizations=create_map,
            output_prefix=f"cn_{session_id}",
        )

        if ctx:
            await ctx.report_progress(progress=7, total=7)

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
        _session_store(session_id, "cn", d, tool_name="create_cn_grid")
        d["_files_saved"] = list(file_paths.values())

        # Push CN raster tile to map (non-fatal)
        try:
            cn_array = result.get("cn_array")
            cn_bounds = result.get("bounds")
            cn_crs = result.get("crs", "")
            if cn_array is not None and cn_bounds is not None:
                from ai_hydro.mcp.map_events import push_raster_layer
                from ai_hydro.analysis.plots import plot_raster_tile
                bounds_wgs84 = _bounds_to_wgs84(
                    list(cn_bounds) if not isinstance(cn_bounds, list) else cn_bounds,
                    cn_crs,
                )
                tile_result = plot_raster_tile(
                    array=cn_array,
                    bounds_wgs84=bounds_wgs84,
                    output_dir=output_dir,
                    name=f"cn_{session_id}",
                    colormap="YlOrRd",
                )
                if tile_result:
                    tile_path, tile_bounds = tile_result
                    push_raster_layer(
                        layer_id=f"cn_{session_id}",
                        name=f"Curve Number: {session_id}",
                        png_path=tile_path,
                        bounds_wgs84=tile_bounds,
                        colormap="YlOrRd",
                        opacity=0.70,
                        auto_zoom=False,
                        metadata={"session_id": session_id, "source": "NLCD + POLARIS"},
                    )
        except Exception as _map_err:
            log.debug("CN grid map push failed (non-fatal): %s", _map_err)

        reminder = _sync_reminder(session_id)
        if reminder:
            d["_sync_required"] = reminder
        return d

    except Exception as e:
        log.error("create_cn_grid failed: %s", e)
        return _tool_error_to_dict(e)


# ============================================================================
# Tool: Forcing Data
# ============================================================================

@mcp.tool()
async def fetch_forcing_data(
    session_id: str,
    start_date: str,
    end_date: str,
    variables: list[str] | None = None,
    ctx: Context | None = None,
) -> dict:
    """
    Fetch basin-averaged daily forcing data from GridMET (CONUS only).

    Retrieves precipitation, temperature, wind, humidity, and solar
    radiation for a watershed. Essential for hydrological modelling input.

    Watershed geometry is loaded automatically from the session (set by
    delineate_watershed). No geometry needed.

    Parameters
    ----------
    session_id : str
        Research session identifier. delineate_watershed must have been
        called for this session first.
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
    >>> fetch_forcing_data('piscataquis-2020', '2000-01-01', '2010-12-31')
    """
    try:
        session_id = _normalize_session_id(session_id)
        from ai_hydro.session import HydroSession as _HS2
        session = _HS2.load(session_id)

        # Cache-hit check — same session + date range already computed
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

        watershed_geojson = _get_session_geometry(session_id)
        from ai_hydro.data.forcing import fetch_forcing_data_result as _fn

        if ctx:
            await ctx.report_progress(progress=0, total=2)

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
        saved = _workspace_write(session_id, f"forcing_{session_id}.json", d["data"])
        # Record data file path in slot so train_hydro_model can reload arrays
        if saved:
            d["data"]["_data_file"] = saved
        _session_store(session_id, "forcing", d, tool_name="fetch_forcing_data")
        compact = _strip_forcing_arrays(d["data"])
        if saved:
            compact["_data_file"] = saved
        resp: dict = {
            "data": compact,
            "meta": d.get("meta", {}),
            "_file_saved": saved,
            "_note": (
                f"Forcing data ({compact.get('n_days', '?')} records, "
                f"{compact.get('n_variables', '?')} variables) saved to "
                f"{saved or 'session'}. Raw daily arrays are NOT in the session JSON "
                "or this response — load from _data_file when needed."
            ),
        }
        reminder = _sync_reminder(session_id)
        if reminder:
            resp["_sync_required"] = reminder
        return resp
    except Exception as e:
        log.error("fetch_forcing_data failed: %s", e)
        return _tool_error_to_dict(e)


# ============================================================================
# Tool: CAMELS-US Catchment Attributes
# ============================================================================

@mcp.tool()
def fetch_camels_us(
    session_id: str,
    gauge_id: str | None = None,
    gauge_ids: list[str] | None = None,
) -> dict:
    """
    Fetch CAMELS-US static catchment attributes — one gauge, many, or all 671.

    pygeohydro.get_camels() downloads all 671 CONUS benchmark gauges in one
    network call, so there is no performance penalty for requesting multiple
    gauges at once.

    Parameters
    ----------
    session_id : str
        Research session identifier.
    gauge_id : str, optional
        Single 8-digit USGS gauge ID. Defaults to session.site_id. Result is
        cached in the session 'camels' slot for downstream use.
    gauge_ids : list[str], optional
        List of 8-digit USGS gauge IDs for bulk retrieval (regional studies,
        benchmark comparisons). Pass an empty list [] to return all 671 gauges.
        Result is NOT cached in session — it is saved directly to workspace.

    Returns
    -------
    Single-gauge mode (gauge_id):
        data.gauge_id          : USGS station ID
        data.in_camels         : True/False
        data.n_attributes      : number of attribute columns (~60)
        data.attributes        : flat dict of all CAMELS attribute values
        data.attribute_groups  : attributes grouped by theme (topography,
                                 climate, hydrology, soil, vegetation, geology)

    Multi-gauge mode (gauge_ids):
        data.mode              : "multi"
        data.n_requested       : number of gauges requested
        data.n_found           : number in CAMELS
        data.not_in_camels     : list of IDs not found
        data.gauges            : {gauge_id: {in_camels, attributes,
                                             attribute_groups}, ...}

    Notes
    -----
    CAMELS covers 671 minimally-disturbed CONUS gauges (1980-2014 record).
    For gauges outside CAMELS, use extract_geomorphic_parameters +
    extract_hydrological_signatures to derive equivalent attributes.

    Citation: Addor et al. (2017), HESS 21.

    Examples
    --------
    >>> fetch_camels_us('piscataquis-2020')                       # session gauge
    >>> fetch_camels_us('study', gauge_id='01031500')             # explicit single
    >>> fetch_camels_us('maine', gauge_ids=['01031500','01013500']) # two gauges
    >>> fetch_camels_us('all-camels', gauge_ids=[])               # all 671
    """
    try:
        import math

        session_id = _normalize_session_id(session_id)
        from ai_hydro.session import HydroSession
        session = HydroSession.load(session_id)

        try:
            import pygeohydro as gh
        except ImportError:
            return {
                "error": True,
                "code": "DEPENDENCY_ERROR",
                "message": "pygeohydro is required to fetch CAMELS-US attributes.",
                "recovery": "pip install aihydro-tools[data]",
            }

        _META = {
            "tool":     "fetch_camels_us",
            "source":   "CAMELS-US via pygeohydro.get_camels()",
            "citation": (
                "Addor, N., Newman, A. J., Mizukami, N., & Clark, M. P. (2017). "
                "The CAMELS data set: catchment attributes and meteorology for "
                "large-sample studies. Hydrology and Earth System Sciences, 21."
            ),
        }

        GROUPS: dict[str, list[str]] = {
            "topography": ["elev_mean", "slope_mean", "area_gages2", "area_geospa_fabric"],
            "climate":    ["p_mean", "pet_mean", "aridity", "frac_snow", "p_seasonality",
                          "high_prec_freq", "high_prec_dur", "low_prec_freq", "low_prec_dur"],
            "hydrology":  ["q_mean", "runoff_ratio", "stream_elas", "slope_fdc",
                          "baseflow_index", "hfd_mean", "q5", "q95"],
            "soil":       ["soil_depth_pelletier", "soil_depth_statsgo", "soil_porosity",
                          "soil_conductivity", "max_water_content",
                          "sand_frac", "silt_frac", "clay_frac"],
            "vegetation": ["frac_forest", "lai_max", "lai_diff", "gvf_max", "gvf_diff"],
            "geology":    ["geol_1st_class", "glim_1st_class_frac", "geol_2nd_class",
                          "carbonate_rocks_frac", "geol_porostiy", "geol_permeability"],
        }

        def _row_to_attrs(row) -> dict:
            out: dict = {}
            for col, val in row.items():
                if col == "geometry":
                    continue
                try:
                    v = float(val)
                    out[col] = None if math.isnan(v) else round(v, 6)
                except (TypeError, ValueError):
                    out[col] = str(val) if val is not None else None
            return out

        def _group(attrs: dict) -> dict:
            return {
                grp: {k: attrs[k] for k in keys if k in attrs}
                for grp, keys in GROUPS.items()
            }

        # ── Fetch the full dataset once ────────────────────────────────
        attr_df, _ = gh.get_camels()
        idx_list = [str(i).zfill(8) for i in attr_df.index]

        # ── MULTI-GAUGE MODE ───────────────────────────────────────────
        if gauge_ids is not None:
            targets = (
                idx_list if len(gauge_ids) == 0          # [] → all 671
                else [g.strip().zfill(8) for g in gauge_ids]
            )
            gauges_out: dict = {}
            not_found: list[str] = []
            for gid in targets:
                if gid not in idx_list:
                    not_found.append(gid)
                    gauges_out[gid] = {"in_camels": False, "attributes": {}, "attribute_groups": {}}
                else:
                    row = attr_df.iloc[idx_list.index(gid)]
                    attrs = _row_to_attrs(row)
                    gauges_out[gid] = {
                        "in_camels":        True,
                        "n_attributes":     len(attrs),
                        "attributes":       attrs,
                        "attribute_groups": _group(attrs),
                    }

            data = {
                "mode":          "multi",
                "n_requested":   len(targets),
                "n_found":       len(targets) - len(not_found),
                "not_in_camels": not_found,
                "gauges":        gauges_out,
            }
            saved = _workspace_write(session_id, "camels_multi.json", data)
            resp: dict = {
                "data": data,
                "meta": _META,
                "_file_saved": saved,
                "_note": (
                    f"CAMELS-US: {data['n_found']}/{data['n_requested']} gauges found. "
                    f"Attributes saved to workspace as camels_multi.json."
                    + (f" Not in CAMELS: {not_found}" if not_found else "")
                ),
            }
            reminder = _sync_reminder(session_id)
            if reminder:
                resp["_sync_required"] = reminder
            return resp

        # ── SINGLE-GAUGE MODE ──────────────────────────────────────────
        if session.camels is not None:
            return {
                "data": session.camels.get("data", {}),
                "meta": session.camels.get("meta", {}),
                "_cached": True,
            }

        usgs_gauge_id = _resolve_usgs_gauge(session_id, gauge_id, session)
        gauge_norm = usgs_gauge_id.zfill(8)

        if gauge_norm not in idx_list:
            return {
                "data": {
                    "gauge_id":        usgs_gauge_id,
                    "in_camels":       False,
                    "attributes":      {},
                    "n_camels_gauges": len(idx_list),
                },
                "meta": _META,
                "_note": (
                    f"Gauge {usgs_gauge_id} is not in the CAMELS-671 benchmark set. "
                    "Use extract_geomorphic_parameters + extract_hydrological_signatures "
                    "to derive equivalent attributes from DEM and streamflow."
                ),
            }

        row = attr_df.iloc[idx_list.index(gauge_norm)]
        attrs = _row_to_attrs(row)
        data = {
            "gauge_id":         usgs_gauge_id,
            "in_camels":        True,
            "n_attributes":     len(attrs),
            "attributes":       attrs,
            "attribute_groups": _group(attrs),
        }
        d = {"data": data, "meta": _META}
        _session_store(session_id, "camels", d, tool_name="fetch_camels_us")
        saved = _workspace_write(session_id, f"camels_{usgs_gauge_id}.json", data)
        d["_file_saved"] = saved
        d["_note"] = (
            f"CAMELS-US: {len(attrs)} attributes for gauge {usgs_gauge_id} "
            "(topography, climate, hydrology, soil, vegetation, geology). "
            "Cached in session slot 'camels'. Saved to workspace."
        )
        reminder = _sync_reminder(session_id)
        if reminder:
            d["_sync_required"] = reminder
        return d

    except Exception as e:
        log.error("fetch_camels_us failed: %s", e)
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


# ============================================================================
# Tool: show_on_map
# ============================================================================

@mcp.tool()
def show_on_map(
    geojson: str,
    name: str = "Layer",
    layer_id: str | None = None,
    layer_type: str = "polygon",
    style_preset: str = "default",
    fill_color: str | None = None,
    stroke_color: str | None = None,
    fill_opacity: float | None = None,
    auto_zoom: bool = True,
) -> dict:
    """
    Push any GeoJSON geometry directly onto the AI-Hydro map panel.

    Use this to visualize custom geometries, study area boundaries,
    analysis outputs, or any spatial data the agent generates.
    The map panel opens automatically if it is not already visible.

    Parameters
    ----------
    geojson : str
        GeoJSON FeatureCollection, Feature, or Geometry as a JSON string.
        Must be valid GeoJSON in EPSG:4326 (longitude/latitude degrees).
    name : str
        Display name shown in the Layers panel (default: 'Layer').
    layer_id : str, optional
        Unique layer key. Re-sending the same ID replaces the existing
        layer. Auto-generated if not provided.
    layer_type : str
        Geometry type hint: 'polygon', 'line', 'point', or 'raster'.
        Controls the icon in the Layers panel (default: 'polygon').
    style_preset : str
        Colour theme: 'watershed' (blue), 'flowlines' (light blue),
        'gauge' (orange point), or 'default' (mid blue).
    fill_color : str, optional
        Hex fill colour override, e.g. '#FF5733'. Overrides preset.
    stroke_color : str, optional
        Hex outline colour override. Overrides preset.
    fill_opacity : float, optional
        Fill opacity 0.0–1.0. Overrides preset.
    auto_zoom : bool
        Fit the map to this layer's bounding box (default: True).

    Returns
    -------
    dict:
        ok     : True if the layer event was queued for the map.
        layer_id : The layer ID used (auto-generated or provided).
        message  : Human-readable status.

    Examples
    --------
    >>> show_on_map(watershed_geojson_string, name='My AOI')
    >>> show_on_map(river_geojson, name='Main Stem', layer_type='line',
    ...             style_preset='flowlines')
    """
    try:
        import uuid as _uuid
        from ai_hydro.mcp.map_events import push_layer

        # Validate JSON before pushing
        try:
            json.loads(geojson)
        except json.JSONDecodeError as jde:
            return {"ok": False, "error": f"Invalid GeoJSON: {jde}"}

        lid = layer_id or f"layer_{_uuid.uuid4().hex[:8]}"

        style_override: dict = {}
        if fill_color:
            style_override["fillColor"] = fill_color
        if stroke_color:
            style_override.update({"color": stroke_color, "strokeColor": stroke_color})
        if fill_opacity is not None:
            style_override["fillOpacity"] = fill_opacity

        ok = push_layer(
            layer_id=lid,
            name=name,
            geojson=geojson,
            layer_type=layer_type,
            style_preset=style_preset,
            style_override=style_override or None,
            auto_zoom=auto_zoom,
            open_map=True,
        )

        return {
            "ok": ok,
            "layer_id": lid,
            "message": (
                f"Layer '{name}' queued for map display."
                if ok else
                "Map event could not be written — VS Code extension may not be running."
            ),
        }
    except Exception as e:
        log.error("show_on_map failed: %s", e)
        return _tool_error_to_dict(e)
