"""
Topographic Wetness Index (TWI) Tool
=====================================

Compute and visualize Topographic Wetness Index for watershed characterization.

The TWI is a topographic index that quantifies the tendency of a location to 
accumulate water based on local slope and upstream contributing area. It is
widely used in hydrological modeling to identify saturated zones, predict soil
moisture patterns, and characterize runoff generation potential.

Formula: TWI = ln(a / tan(β))
where:
    a = specific catchment area (m²/m)
    β = local slope angle (radians)

Functions
---------
compute_twi(watershed_geom, resolution=30, save_outputs=False, output_dir=None) -> dict
    Compute TWI and generate statistics and visualizations
    
get_twi_interpretation(twi_value: float) -> str
    Interpret TWI value in hydrological terms

Examples
--------
>>> from ai_hydro.tools import compute_twi
>>> result = compute_twi(watershed_geom, resolution=30)
>>> print(f"Mean TWI: {result['twi_mean']:.2f}")
>>> print(f"High saturation zones: {result['percent_high_twi']:.1f}%")

References
----------
- Beven, K.J. and Kirkby, M.J., 1979. A physically based, variable contributing
  area model of basin hydrology. Hydrological Sciences Bulletin, 24(1), pp.43-69.
- Sørensen, R., Zinko, U. and Seibert, J., 2006. On the calculation of the 
  topographic wetness index: evaluation of different methods based on field
  observations. Hydrology and Earth System Sciences, 10(1), pp.101-112.
"""
from __future__ import annotations

import logging
from typing import Callable, Dict, Optional, Tuple
import warnings
warnings.filterwarnings('ignore')

log = logging.getLogger(__name__)

# Public API
__all__ = ['compute_twi', 'get_twi_interpretation', 'classify_twi_zones']

_TWI_CMAP_NAME = "cividis"
_TWI_DISPLAY_RANGE = (4, 16)
_TWI_ZONE_COLORS = {
    "high": "#F2C94C",
    "medium": "#7F7F7F",
    "low": "#355C7D",
}

try:
    import py3dep
    import numpy as np
    import geopandas as gpd
    from pysheds.grid import Grid
    import tempfile
    import os
    import json
    DEPS_AVAILABLE = True
except ImportError:
    DEPS_AVAILABLE = False

# Optional dependencies for visualization
try:
    import matplotlib
    matplotlib.use("Agg")  # headless backend — MCP server has no display
    import matplotlib.pyplot as plt
    import matplotlib.colors as colors
    from matplotlib.patches import Rectangle
    import rasterio
    from rasterio.plot import show
    import folium
    from folium import plugins
    VIZ_AVAILABLE = True
except ImportError:
    VIZ_AVAILABLE = False


def compute_twi(
    watershed_geom,
    resolution: int = 30,
    save_outputs: bool = False,
    output_dir: Optional[str] = None,
    output_prefix: str = "twi",
    create_visualizations: bool = True,
    min_slope_deg: float = 0.1,
    progress_callback: Optional[Callable] = None,
) -> Dict:
    """
    Compute Topographic Wetness Index (TWI) for a watershed.
    
    This function calculates TWI using high-resolution DEM data and flow
    accumulation analysis. It provides comprehensive statistics, zone
    classification, and optional visualizations.
    
    Parameters
    ----------
    watershed_geom : shapely.Polygon or geopandas.GeoDataFrame
        Watershed boundary geometry in WGS84 (EPSG:4326)
    resolution : int, optional
        DEM resolution in meters (default: 30m)
        Options: 10, 30, or 60 meters
    save_outputs : bool, optional
        Whether to save TWI raster and statistics to files (default: False)
    output_dir : str, optional
        Directory to save outputs if save_outputs=True
    output_prefix : str, optional
        Prefix for output filenames (default: "twi")
    create_visualizations : bool, optional
        Whether to create static and interactive maps (default: True)
    min_slope_deg : float, optional
        Minimum slope in degrees to avoid division by zero (default: 0.1)
    progress_callback : callable, optional
        Called at each processing stage as ``progress_callback(step, total, msg)``.
        Useful for MCP progress reporting. (default: None)

    Returns
    -------
    dict
        Dictionary containing:
        - **Statistics**:
          - twi_mean, twi_median, twi_min, twi_max, twi_std
          - twi_p10, twi_p25, twi_p75, twi_p90
        - **Zone Classification**:
          - percent_low_twi, percent_medium_twi, percent_high_twi
        - **Spatial Data**:
          - twi_array: 2D numpy array of TWI values
          - bounds, crs, resolution_m
        - **files_saved** : list[str]
          Paths written to disk (empty when save_outputs=False).
        - **File Paths** (if save_outputs=True):
          - twi_raster_path, statistics_json_path
          - static_map_path, interactive_map_path (if visualizations created)
        
    Raises
    ------
    ValueError
        If watershed geometry is invalid or resolution unsupported
    ImportError
        If required dependencies are not installed
        
    Examples
    --------
    >>> # Basic usage
    >>> result = compute_twi(watershed_geom)
    >>> print(f"Mean TWI: {result['twi_mean']:.2f}")
    >>> print(f"High saturation zones: {result['percent_high_twi']:.1f}%")
    
    >>> # Save outputs with custom resolution
    >>> result = compute_twi(
    ...     watershed_geom,
    ...     resolution=10,
    ...     save_outputs=True,
    ...     output_dir="./outputs",
    ...     output_prefix="my_watershed_twi"
    ... )
    
    >>> # Access TWI raster for further analysis
    >>> twi_raster = result['twi_array']
    >>> high_twi_mask = twi_raster > 10
    >>> saturated_area_pct = (high_twi_mask.sum() / twi_raster.size) * 100
    
    Notes
    -----
    - Uses USGS 3DEP DEM for elevation data
    - Uses py3dep for slope calculation
    - Flow direction computed using D8 algorithm via pysheds
    - TWI formula: ln(a / tan(slope)) where a is specific catchment area
    - Processing time increases with finer resolution and larger watersheds
    - Typical values: 2-20+ (higher = more likely to be saturated)
    - TWI is sensitive to DEM resolution; finer resolution captures more detail
    """
    
    if not DEPS_AVAILABLE:
        raise ImportError(
            "Required dependencies not installed. "
            "Install with: pip install py3dep pysheds geopandas numpy rioxarray xarray"
        )
    
    # Validate inputs
    if resolution not in [10, 30, 60]:
        raise ValueError(
            f"Resolution must be 10, 30, or 60 meters. Got: {resolution}"
        )
    
    # Convert GeoDataFrame to geometry if needed
    if isinstance(watershed_geom, gpd.GeoDataFrame):
        if len(watershed_geom) == 0:
            raise ValueError("Empty GeoDataFrame provided")
        watershed_geom = watershed_geom.geometry.iloc[0]
    
    print("=" * 60)
    print("TOPOGRAPHIC WETNESS INDEX (TWI) COMPUTATION")
    print("=" * 60)
    print(f"\nConfiguration:")
    print(f"  Resolution: {resolution}m")
    print(f"  Min slope: {min_slope_deg}°")
    print(f"  Save outputs: {save_outputs}")
    print(f"  Create visualizations: {create_visualizations}")
    
    try:
        def _progress(step: int, total: int, msg: str) -> None:
            print(f"\n{step}. {msg}")
            if progress_callback is not None:
                progress_callback(step, total, msg)

        # === Step 1: Download DEM ===
        _progress(1, 10, "Downloading DEM from USGS 3DEP...")
        dem = py3dep.get_map(
            "DEM", 
            watershed_geom, 
            resolution=resolution, 
            geo_crs=4326, 
            crs=5070
        )
        print(f"   ✓ DEM shape: {dem.shape}")
        print(f"   ✓ Elevation range: {float(dem.min()):.1f} - {float(dem.max()):.1f} m")
        
        # === Step 2: Setup pysheds Grid ===
        _progress(2, 10, "Initializing flow analysis...")
        with tempfile.NamedTemporaryFile(suffix='.tif', delete=False) as tmp:
            tmp_dem_path = tmp.name
        dem.rio.to_raster(tmp_dem_path)
        
        grid = Grid.from_raster(tmp_dem_path)
        dem_data = grid.read_raster(tmp_dem_path)
        print("   ✓ Grid initialized")
        
        # === Step 3: Condition DEM ===
        _progress(3, 10, "Conditioning DEM (fill pits, depressions, resolve flats)...")
        pit_filled_dem = grid.fill_pits(dem_data)
        flooded_dem = grid.fill_depressions(pit_filled_dem)
        inflated_dem = grid.resolve_flats(flooded_dem)
        print("   ✓ DEM conditioned")
        
        # === Step 4: Compute Flow Direction (D8) ===
        _progress(4, 10, "Computing flow direction (D8 algorithm)...")
        dirmap = (64, 128, 1, 2, 4, 8, 16, 32)
        fdir = grid.flowdir(inflated_dem, dirmap=dirmap)
        print("   ✓ Flow direction computed")
        
        # === Step 5: Compute Flow Accumulation ===
        _progress(5, 10, "Computing flow accumulation...")
        acc = grid.accumulation(fdir, dirmap=dirmap)
        print(f"   ✓ Flow accumulation computed")
        print(f"   ✓ Max accumulation: {acc.max():.0f} cells")
        
        # === Step 6: Download Slope ===
        _progress(6, 10, "Downloading slope data from USGS 3DEP...")
        slope_deg = py3dep.get_map(
            "Slope Degrees", 
            watershed_geom, 
            resolution=resolution, 
            geo_crs=4326, 
            crs=5070
        )
        print(f"   ✓ Slope range: {float(slope_deg.min()):.2f} - {float(slope_deg.max()):.2f}°")
        
        # === Step 7: Calculate TWI ===
        _progress(7, 10, "Computing Topographic Wetness Index...")
        
        # Convert slope to radians
        slope_rad = np.radians(slope_deg.values)
        
        # Set minimum slope to avoid division by zero
        min_slope_rad = np.radians(min_slope_deg)
        slope_rad = np.where(slope_rad < min_slope_rad, min_slope_rad, slope_rad)
        
        # Get cell size in meters
        cell_size = abs(dem.rio.resolution()[0])
        
        # Specific catchment area (m²/m)
        # SCA = (acc * cell_size²) / cell_size = acc * cell_size
        sca = acc * cell_size
        
        # Calculate TWI = ln(a / tan(slope))
        twi = np.log(sca / np.tan(slope_rad))
        
        # Mask invalid values
        twi_masked = np.where(np.isfinite(twi), twi, np.nan)
        
        print("   ✓ TWI computed successfully")
        
        # === Step 8: Calculate Statistics ===
        _progress(8, 10, "Computing statistics...")
        
        valid_twi = twi_masked[~np.isnan(twi_masked)]
        
        # Basic statistics
        twi_stats = {
            'twi_mean': float(np.mean(valid_twi)),
            'twi_median': float(np.median(valid_twi)),
            'twi_min': float(np.min(valid_twi)),
            'twi_max': float(np.max(valid_twi)),
            'twi_std': float(np.std(valid_twi)),
            'twi_p10': float(np.percentile(valid_twi, 10)),
            'twi_p25': float(np.percentile(valid_twi, 25)),
            'twi_p75': float(np.percentile(valid_twi, 75)),
            'twi_p90': float(np.percentile(valid_twi, 90)),
        }
        
        # Zone classification
        low_twi = valid_twi < 6
        medium_twi = (valid_twi >= 6) & (valid_twi <= 10)
        high_twi = valid_twi > 10
        
        twi_stats['percent_low_twi'] = float((low_twi.sum() / len(valid_twi)) * 100)
        twi_stats['percent_medium_twi'] = float((medium_twi.sum() / len(valid_twi)) * 100)
        twi_stats['percent_high_twi'] = float((high_twi.sum() / len(valid_twi)) * 100)
        
        # Spatial metadata
        bounds = dem.rio.bounds()
        twi_stats['bounds'] = [float(bounds[0]), float(bounds[1]), 
                               float(bounds[2]), float(bounds[3])]
        twi_stats['crs'] = str(dem.rio.crs)
        twi_stats['resolution_m'] = float(cell_size)
        twi_stats['twi_array'] = twi_masked
        
        # Print summary
        print("\n" + "=" * 60)
        print("TWI STATISTICS")
        print("=" * 60)
        print(f"\n📊 Summary Statistics:")
        print(f"  Mean TWI:       {twi_stats['twi_mean']:.2f}")
        print(f"  Median TWI:     {twi_stats['twi_median']:.2f}")
        print(f"  Min TWI:        {twi_stats['twi_min']:.2f}")
        print(f"  Max TWI:        {twi_stats['twi_max']:.2f}")
        print(f"  Std Dev:        {twi_stats['twi_std']:.2f}")
        print(f"\n  Percentiles:")
        print(f"    10th:         {twi_stats['twi_p10']:.2f}")
        print(f"    25th:         {twi_stats['twi_p25']:.2f}")
        print(f"    75th:         {twi_stats['twi_p75']:.2f}")
        print(f"    90th:         {twi_stats['twi_p90']:.2f}")
        print(f"\n📍 Zone Classification:")
        print(f"  Well-drained (TWI < 6):      {twi_stats['percent_low_twi']:.1f}%")
        print(f"  Moderate (6 ≤ TWI ≤ 10):     {twi_stats['percent_medium_twi']:.1f}%")
        print(f"  Saturated (TWI > 10):        {twi_stats['percent_high_twi']:.1f}%")
        print("\n" + "=" * 60)
        
        # === Step 9: Save Outputs ===
        files_saved: list[str] = []
        if save_outputs:
            _progress(9, 10, "Saving outputs...")

            if output_dir is None:
                output_dir = "."
            os.makedirs(output_dir, exist_ok=True)

            # Save TWI raster
            twi_xr = dem.copy(data=twi_masked)
            twi_xr.name = "twi"
            twi_xr.attrs['long_name'] = 'Topographic Wetness Index'
            twi_xr.attrs['units'] = 'dimensionless'
            twi_xr.attrs['formula'] = 'ln(a / tan(slope))'

            raster_path = os.path.join(output_dir, f"{output_prefix}.tif")
            twi_xr.rio.to_raster(raster_path, compress='LZW')
            twi_stats['twi_raster_path'] = raster_path
            files_saved.append(raster_path)
            print(f"   ✓ TWI raster saved: {raster_path}")

            # Save statistics JSON
            stats_for_json = {k: v for k, v in twi_stats.items()
                            if k not in ['twi_array']}  # Exclude array from JSON
            json_path = os.path.join(output_dir, f"{output_prefix}_statistics.json")
            with open(json_path, 'w') as f:
                json.dump(stats_for_json, f, indent=2, default=str)
            twi_stats['statistics_json_path'] = json_path
            files_saved.append(json_path)
            print(f"   ✓ Statistics saved: {json_path}")

        # === Step 10: Create Visualizations ===
        if create_visualizations:
            if not VIZ_AVAILABLE:
                log.warning("Visualization libraries not available — skipping maps. "
                            "Install with: pip install matplotlib rasterio folium")
            else:
                _progress(10, 10, "Creating visualizations...")
                # Static map — independent try/except so interactive failure can't prevent PNG
                try:
                    viz_paths = _create_static_map(
                        twi_masked, twi_stats, output_dir,
                        output_prefix, save_outputs
                    )
                    twi_stats.update(viz_paths)
                    if viz_paths.get('static_map_path'):
                        files_saved.append(viz_paths['static_map_path'])
                except Exception as static_err:
                    log.warning("TWI static map creation failed: %s", static_err)
                    twi_stats['_static_map_error'] = str(static_err)

                # Interactive map — separate try/except so PNG is never blocked by this
                if save_outputs:
                    try:
                        interactive_path = _create_interactive_map(
                            watershed_geom, twi_masked, twi_stats,
                            output_dir, output_prefix, raster_path
                        )
                        twi_stats['interactive_map_path'] = interactive_path
                        files_saved.append(interactive_path)
                    except Exception as html_err:
                        log.warning("TWI interactive map creation failed: %s", html_err)
                        twi_stats['_interactive_map_error'] = str(html_err)

        twi_stats['files_saved'] = files_saved
        
        # Clean up temp file
        os.unlink(tmp_dem_path)
        
        print("\n" + "=" * 60)
        print("✅ COMPUTATION COMPLETE")
        print("=" * 60)
        
        return twi_stats
        
    except Exception as e:
        error_msg = f"Failed to compute TWI: {str(e)}"
        print(f"\n✗ {error_msg}")
        raise ValueError(error_msg) from e


def _create_static_map(
    twi_masked: np.ndarray,
    twi_stats: Dict,
    output_dir: str,
    output_prefix: str,
    save: bool
) -> Dict:
    """Create static matplotlib visualization of TWI."""

    fig, axes = plt.subplots(1, 2, figsize=(16, 7))

    bounds = twi_stats.get("bounds")
    crs_label = twi_stats.get("crs") or "unknown CRS"
    extent = None
    x_label = f"X Coordinate ({crs_label})"
    y_label = f"Y Coordinate ({crs_label})"
    if isinstance(bounds, (list, tuple)) and len(bounds) == 4:
        extent = [bounds[0], bounds[2], bounds[1], bounds[3]]

    # Plot TWI map
    im1 = axes[0].imshow(
        twi_masked,
        cmap=_TWI_CMAP_NAME,
        vmin=_TWI_DISPLAY_RANGE[0],
        vmax=_TWI_DISPLAY_RANGE[1],
        extent=extent,
        origin="upper",
        interpolation="nearest",
    )
    axes[0].set_title(
        'Topographic Wetness Index (TWI)', 
        fontsize=14, fontweight='bold'
    )
    axes[0].set_xlabel(x_label)
    axes[0].set_ylabel(y_label)
    axes[0].ticklabel_format(style="plain", axis="both", useOffset=False)
    cbar1 = plt.colorbar(im1, ax=axes[0], fraction=0.046, pad=0.04)
    cbar1.set_label('TWI (dimensionless)', rotation=270, labelpad=20)

    # Add legend
    legend_elements = [
        Rectangle((0, 0), 1, 1, fc=_TWI_ZONE_COLORS["high"], label='High TWI (>10): Saturated'),
        Rectangle((0, 0), 1, 1, fc=_TWI_ZONE_COLORS["medium"], label='Medium TWI (6-10): Moderate'),
        Rectangle((0, 0), 1, 1, fc=_TWI_ZONE_COLORS["low"], label='Low TWI (<6): Well-drained')
    ]
    axes[0].legend(handles=legend_elements, loc='lower right', fontsize=9)

    # Plot histogram
    valid_twi = twi_masked[~np.isnan(twi_masked)].flatten()
    axes[1].hist(valid_twi, bins=50, color=_TWI_ZONE_COLORS["low"],
                alpha=0.75, edgecolor='black')
    axes[1].axvline(twi_stats['twi_mean'], color=_TWI_ZONE_COLORS["high"],
                   linestyle='--', linewidth=2,
                   label=f"Mean: {twi_stats['twi_mean']:.2f}")
    axes[1].axvline(twi_stats['twi_median'], color=_TWI_ZONE_COLORS["medium"],
                   linestyle='--', linewidth=2,
                   label=f"Median: {twi_stats['twi_median']:.2f}")
    axes[1].set_xlabel('TWI Value', fontsize=12)
    axes[1].set_ylabel('Frequency', fontsize=12)
    axes[1].set_title('TWI Distribution', fontsize=14, fontweight='bold')
    axes[1].legend(fontsize=10)
    axes[1].grid(True, alpha=0.3)
    
    plt.tight_layout()
    
    if save:
        static_path = os.path.join(output_dir, f"{output_prefix}_map.png")
        plt.savefig(static_path, dpi=300, bbox_inches='tight')
        print(f"   ✓ Static map saved: {static_path}")
        plt.close()
        return {'static_map_path': static_path}
    else:
        plt.show()
        return {}


def _create_interactive_map(
    watershed_geom,
    twi_masked: np.ndarray,
    twi_stats: Dict,
    output_dir: str,
    output_prefix: str,
    raster_path: str
) -> str:
    """Create interactive folium map with TWI overlay."""
    
    # Convert watershed to WGS84 if needed
    if isinstance(watershed_geom, gpd.GeoDataFrame):
        gdf_wgs84 = watershed_geom.to_crs(epsg=4326)
    else:
        gdf_wgs84 = gpd.GeoDataFrame(
            geometry=[watershed_geom], crs='EPSG:4326'
        )
    
    bounds = gdf_wgs84.total_bounds
    center_lat = (bounds[1] + bounds[3]) / 2
    center_lon = (bounds[0] + bounds[2]) / 2
    
    # Create base map
    m = folium.Map(
        location=[center_lat, center_lon],
        zoom_start=11,
        tiles='OpenStreetMap'
    )
    
    # Add tile layers
    folium.TileLayer('cartodbpositron', name='Light').add_to(m)
    folium.TileLayer(
        'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
        attr='Esri',
        name='Satellite',
        overlay=False,
        control=True
    ).add_to(m)
    
    # Add watershed boundary
    folium.GeoJson(
        gdf_wgs84,
        name='Watershed Boundary',
        style_function=lambda x: {
            'fillColor': 'transparent',
            'color': 'red',
            'weight': 3,
            'fillOpacity': 0
        },
        tooltip="Watershed Boundary"
    ).add_to(m)
    
    # Add TWI overlay
    with rasterio.open(raster_path) as src:
        from rasterio.warp import transform_bounds
        twi_bounds_wgs84 = transform_bounds(src.crs, 'EPSG:4326', *src.bounds)

        # Create colormap image
        norm = colors.Normalize(vmin=_TWI_DISPLAY_RANGE[0], vmax=_TWI_DISPLAY_RANGE[1])
        cmap = plt.cm.get_cmap(_TWI_CMAP_NAME)
        twi_rgb = cmap(norm(np.ma.masked_invalid(src.read(1))))

        # Save overlay image
        overlay_path = os.path.join(output_dir, f"{output_prefix}_overlay.png")
        plt.imsave(overlay_path, twi_rgb)
    
    folium.raster_layers.ImageOverlay(
        image=overlay_path,
        bounds=[[twi_bounds_wgs84[1], twi_bounds_wgs84[0]], 
                [twi_bounds_wgs84[3], twi_bounds_wgs84[2]]],
        opacity=0.6,
        name='TWI Overlay'
    ).add_to(m)
    
    # Add legend
    legend_html = '''
    <div style="position: fixed; 
                bottom: 50px; right: 50px; width: 220px; height: 170px; 
                background-color: white; border:2px solid grey; z-index:9999; 
                font-size:14px; padding: 10px">
    <p style="margin: 0; font-weight: bold;">TWI Classes</p>
    <p style="margin: 5px 0;"><span style="background-color: ''' + _TWI_ZONE_COLORS["high"] + '''; padding: 2px 10px;">  </span> High (>10): Saturated</p>
    <p style="margin: 5px 0;"><span style="background-color: ''' + _TWI_ZONE_COLORS["medium"] + '''; padding: 2px 10px;">  </span> Medium (6-10): Moderate</p>
    <p style="margin: 5px 0;"><span style="background-color: ''' + _TWI_ZONE_COLORS["low"] + '''; padding: 2px 10px;">  </span> Low (<6): Well-drained</p>
    <p style="margin: 8px 0 0 0; font-size: 12px;">Mean: {mean:.2f}</p>
    <p style="margin: 4px 0 0 0; font-size: 12px;">Palette: Cividis</p>
    </div>
    '''.format(mean=twi_stats['twi_mean'])
    m.get_root().html.add_child(folium.Element(legend_html))
    
    # Add controls
    folium.LayerControl().add_to(m)
    plugins.MiniMap().add_to(m)
    
    # Save map
    map_path = os.path.join(output_dir, f"{output_prefix}_interactive_map.html")
    m.save(map_path)
    print(f"   ✓ Interactive map saved: {map_path}")
    
    return map_path


def get_twi_interpretation(twi_value: float) -> str:
    """
    Interpret a TWI value in hydrological terms.
    
    Parameters
    ----------
    twi_value : float
        TWI value to interpret
        
    Returns
    -------
    str
        Interpretation of the TWI value
        
    Examples
    --------
    >>> get_twi_interpretation(5.2)
    'Well-drained area with low water accumulation tendency'
    >>> get_twi_interpretation(8.5)
    'Moderately wet area with intermediate drainage'
    >>> get_twi_interpretation(12.3)
    'Poorly drained, saturated area with high water accumulation'
    """
    
    if twi_value < 6:
        return "Well-drained area with low water accumulation tendency"
    elif 6 <= twi_value <= 10:
        return "Moderately wet area with intermediate drainage"
    else:
        return "Poorly drained, saturated area with high water accumulation"


def classify_twi_zones(twi_array: np.ndarray) -> Dict:
    """
    Classify TWI values into drainage zones.
    
    Parameters
    ----------
    twi_array : np.ndarray
        2D array of TWI values
        
    Returns
    -------
    dict
        Dictionary with zone masks and percentages:
        - well_drained_mask: Boolean array for TWI < 6
        - moderate_mask: Boolean array for 6 ≤ TWI ≤ 10
        - saturated_mask: Boolean array for TWI > 10
        - percent_well_drained: Percentage of well-drained area
        - percent_moderate: Percentage of moderate area
        - percent_saturated: Percentage of saturated area
        
    Examples
    --------
    >>> zones = classify_twi_zones(twi_array)
    >>> print(f"Saturated zones: {zones['percent_saturated']:.1f}%")
    >>> saturated_locations = np.where(zones['saturated_mask'])
    """
    
    valid_mask = np.isfinite(twi_array)
    valid_count = valid_mask.sum()
    
    well_drained = twi_array < 6
    moderate = (twi_array >= 6) & (twi_array <= 10)
    saturated = twi_array > 10
    
    return {
        'well_drained_mask': well_drained & valid_mask,
        'moderate_mask': moderate & valid_mask,
        'saturated_mask': saturated & valid_mask,
        'percent_well_drained': float((well_drained & valid_mask).sum() / valid_count * 100),
        'percent_moderate': float((moderate & valid_mask).sum() / valid_count * 100),
        'percent_saturated': float((saturated & valid_mask).sum() / valid_count * 100),
    }


def compute_twi_result(
    watershed_geojson: dict,
    resolution: int = 30,
    min_slope_deg: float = 0.1,
) -> "HydroResult":
    """
    Compute TWI for a watershed, returning a standardized HydroResult.

    Parameters
    ----------
    watershed_geojson : dict
        GeoJSON geometry dict (e.g. from delineate_watershed result).
    resolution : int
        DEM resolution in meters (10, 30, or 60).
    min_slope_deg : float
        Minimum slope in degrees to avoid division by zero (default 0.1).

    Returns
    -------
    HydroResult
        data keys: twi_mean, twi_median, twi_min, twi_max, twi_std,
        twi_p10, twi_p25, twi_p75, twi_p90,
        percent_low_twi, percent_medium_twi, percent_high_twi,
        resolution_m, bounds, crs
    """
    from shapely.geometry import shape
    from ai_hydro.core import DataSource, HydroMeta, HydroResult, ToolError

    _TOOL_PATH = "ai_hydro.tools.twi.compute_twi_result"
    _SOURCES = [
        DataSource(
            name="3DEP (USGS 3D Elevation Program)",
            url="https://www.usgs.gov/3d-elevation-program",
            citation=(
                "@misc{usgs_3dep_2022, title={3D Elevation Program}, "
                "author={{U.S. Geological Survey}}, year={2022}, "
                "url={https://www.usgs.gov/3d-elevation-program}}"
            ),
        ),
    ]

    try:
        from ai_hydro import __version__

        watershed_geom = shape(watershed_geojson)

        raw = compute_twi(
            watershed_geom=watershed_geom,
            resolution=resolution,
            save_outputs=False,
            create_visualizations=False,
            min_slope_deg=min_slope_deg,
        )

        # scalar statistics — already floats, but guard against NaN
        scalar_keys = [
            "twi_mean", "twi_median", "twi_min", "twi_max", "twi_std",
            "twi_p10", "twi_p25", "twi_p75", "twi_p90",
            "percent_low_twi", "percent_medium_twi", "percent_high_twi",
            "resolution_m",
        ]
        clean: dict = {}
        for k in scalar_keys:
            v = raw.get(k)
            if v is None:
                clean[k] = None
            else:
                try:
                    fv = float(v)
                    clean[k] = fv if np.isfinite(fv) else None
                except (TypeError, ValueError):
                    clean[k] = None

        # bounds — list of 4 floats
        bounds = raw.get("bounds")
        if bounds is not None:
            try:
                clean["bounds"] = [float(b) for b in bounds]
            except (TypeError, ValueError):
                clean["bounds"] = None
        else:
            clean["bounds"] = None

        clean["crs"] = raw.get("crs")

        return HydroResult(
            data=clean,
            meta=HydroMeta(
                tool=_TOOL_PATH,
                version=__version__,
                gauge_id=None,
                sources=_SOURCES,
                params={"resolution": resolution, "min_slope_deg": min_slope_deg},
            ),
        )

    except ToolError:
        raise
    except Exception as exc:
        raise ToolError(
            code="TWI_COMPUTATION_FAILED",
            message=str(exc),
            tool=_TOOL_PATH,
            recovery=(
                "Ensure the watershed_geojson is a valid GeoJSON polygon. "
                "Install geomorphic extras: pip install 'ai-hydro[geomorphic]'"
            ),
        ) from exc


# Example usage for testing
if __name__ == "__main__":
    import geopandas as gpd
    
    print("TWI Tool - Test Mode")
    print("=" * 60)
    
    # Test with a sample watershed (you would load your own)
    print("\n⚠️  Please provide a watershed geometry to test.")
    print("Example:")
    print("  gdf = gpd.read_file('watershed.geojson')")
    print("  result = compute_twi(gdf.geometry[0])")
    print("\nOr use the delineate_watershed tool:")
    print("  from ai_hydro.tools.watershed import delineate_watershed")
    print("  ws = delineate_watershed('01031500')")
    print("  result = compute_twi(ws['geometry'])")
