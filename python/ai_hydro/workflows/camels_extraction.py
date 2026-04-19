"""
CAMELS Extraction Workflow
===========================

Tier 3: Complete CAMELS-like catchment attribute extraction workflow.

This module provides the high-level "one-click" workflow that orchestrates
all Tier 2 tools to extract comprehensive catchment attributes following
the CAMELS methodology.

Main Function
-------------
fetch_camels_attributes(gauge_id, ...) -> dict
    Complete CAMELS-like attribute extraction for any USGS gauge

Example
-------
>>> from ai_hydro.workflows import fetch_camels_attributes
>>> result = fetch_camels_attributes('01031500')
>>> print(f"Extracted {len(result['attributes'])} attributes")
>>> print(f"Watershed area: {result['attributes']['area_km2']:.1f} km²")
"""

from typing import Dict, Tuple, Optional
from datetime import datetime
import warnings
warnings.filterwarnings('ignore')


def fetch_camels_attributes(
    gauge_id: str,
    climate_dates: Tuple[str, str] = ("2000-01-01", "2020-12-31"),
    hydro_dates: Tuple[str, str] = ("1989-10-01", "2009-09-30"),
    output_dir: Optional[str] = None,
    save_results: bool = False
) -> Dict:
    """
    Complete CAMELS-like attribute extraction for a USGS gauge.
    
    This is the main "one-click" workflow that extracts all 6 categories
    of catchment attributes following the CAMELS methodology.
    
    Parameters
    ----------
    gauge_id : str
        8-digit USGS gauge identifier (e.g., '01031500')
    climate_dates : tuple of str
        (start_date, end_date) for climate indices in YYYY-MM-DD format
        Default: ("2000-01-01", "2020-12-31")
    hydro_dates : tuple of str
        (start_date, end_date) for hydrological signatures in YYYY-MM-DD format
        Default: ("1989-10-01", "2009-09-30")  # CAMELS standard period
    output_dir : str, optional
        Directory to save results. If None, results not saved to disk.
    save_results : bool
        Whether to save results to CSV/JSON files (default: False)
        
    Returns
    -------
    dict
        Comprehensive results dictionary containing:
        
        - 'gauge_id': str - USGS gauge identifier
        - 'extraction_date': str - When extraction was performed
        - 'success': bool - Whether extraction was successful
        - 'attributes': dict - All extracted attributes (70+ variables)
        - 'metadata': dict - Gauge metadata (name, location, HUC)
        - 'files': dict - Paths to saved files (if save_results=True)
        - 'errors': list - Any errors encountered during extraction
        
    Attributes Extracted
    --------------------
    The 'attributes' dictionary contains:
    
    **Metadata** (from watershed delineation):
        - gauge_id, gauge_name, gauge_lat, gauge_lon, huc_02
        
    **Topography** (from 3DEP DEM):
        - elev_mean, elev_min, elev_max, elev_std
        - slope_mean, slope_std
        - area_geospa_fabric
        
    **Climate** (from GridMET):
        - p_mean, pet_mean, temp_mean
        - aridity, p_seasonality, frac_snow
        - extreme precipitation statistics
        
    **Soil** (from gNATSGO/POLARIS):
        - soil_porosity, sand_frac, silt_frac, clay_frac
        - soil_depth_statsgo, max_water_content
        
    **Vegetation** (from MODIS/NLCD):
        - lai_max, lai_diff, gvf_max
        - frac_forest, dom_land_cover, root_depth
        
    **Geology** (from GLiM/GLHYMPS):
        - geol_1st_class, geol_permeability
        - geol_porostiy, carbonate_rocks_frac
        
    **Hydrology** (from NWIS):
        - q_mean, runoff_ratio, baseflow_index
        - slope_fdc, high_q_freq, low_q_freq
        - timing metrics
        
    Examples
    --------
    >>> # Simple extraction
    >>> result = fetch_camels_attributes('01031500')
    >>> attrs = result['attributes']
    >>> print(f"Elevation: {attrs['elev_mean']:.1f}m")
    >>> print(f"Aridity: {attrs['aridity']:.2f}")
    
    >>> # With custom date ranges and file export
    >>> result = fetch_camels_attributes(
    ...     '01031500',
    ...     climate_dates=("2010-01-01", "2020-12-31"),
    ...     save_results=True,
    ...     output_dir='./camels_output'
    ... )
    >>> print(f"Results saved to: {result['files']['csv']}")
    
    Notes
    -----
    - Extraction typically takes 2-5 minutes per gauge
    - Requires internet connection for data downloads
    - Some attributes may be NaN if data unavailable
    - Uses CAMELS methodology (Newman et al. 2015, Addor et al. 2017)
    
    Raises
    ------
    ValueError
        If gauge_id is invalid or not found
    ImportError
        If required dependencies are not installed
        
    See Also
    --------
    ai_hydro.tools : Individual attribute extraction functions
    """
    
    print("="*70)
    print(f"CAMELS-LIKE ATTRIBUTE EXTRACTION")
    print(f"Gauge: {gauge_id}")
    print(f"Started: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print("="*70)
    
    result = {
        'gauge_id': gauge_id,
        'extraction_date': datetime.now().strftime('%Y-%m-%d'),
        'success': False,
        'attributes': {},
        'metadata': {},
        'files': {},
        'errors': []
    }
    
    try:
        # Import Tier 2 tools
        from ai_hydro.tools import (
            delineate_watershed,
            extract_topographic_attributes,
            extract_climate_indices,
            extract_soil_attributes,
            extract_vegetation_attributes,
            extract_geological_attributes,
            extract_hydrological_signatures
        )
        
        # ===== STEP 1: WATERSHED DELINEATION =====
        print("\n[1/7] Watershed Delineation")
        print("-" * 70)
        try:
            watershed = delineate_watershed(gauge_id)
            result['metadata'] = {
                'gauge_id': watershed['gauge_id'],
                'gauge_name': watershed['gauge_name'],
                'gauge_lat': watershed['gauge_lat'],
                'gauge_lon': watershed['gauge_lon'],
                'huc_02': watershed['huc_02'],
                'area_km2': watershed['area_km2'],
            }
            result['attributes'].update(result['metadata'])
            print(f"✅ SUCCESS: {watershed['gauge_name']}")
            print(f"    Area: {watershed['area_km2']:.1f} km²")
        except Exception as e:
            result['errors'].append(f"Watershed delineation: {str(e)}")
            print(f"❌ FAILED: {e}")
            raise
        
        # ===== STEP 2: TOPOGRAPHIC ATTRIBUTES =====
        print("\n[2/7] Topographic Attributes")
        print("-" * 70)
        try:
            topo_attrs = extract_topographic_attributes(watershed['geometry'])
            result['attributes'].update(topo_attrs)
            print(f"✅ SUCCESS: Extracted {len(topo_attrs)} attributes")
        except Exception as e:
            result['errors'].append(f"Topography: {str(e)}")
            print(f"⚠️  WARNING: {e}")
        
        # ===== STEP 3: CLIMATE INDICES =====
        print("\n[3/7] Climate Indices")
        print("-" * 70)
        try:
            climate_attrs = extract_climate_indices(
                watershed['geometry'],
                climate_dates[0],
                climate_dates[1]
            )
            result['attributes'].update(climate_attrs)
            print(f"✅ SUCCESS: Extracted {len(climate_attrs)} attributes")
        except Exception as e:
            result['errors'].append(f"Climate: {str(e)}")
            print(f"⚠️  WARNING: {e}")
        
        # ===== STEP 4: SOIL CHARACTERISTICS =====
        print("\n[4/7] Soil Characteristics")
        print("-" * 70)
        try:
            soil_attrs = extract_soil_attributes(watershed['geometry'])
            result['attributes'].update(soil_attrs)
            print(f"✅ SUCCESS: Extracted {len(soil_attrs)} attributes")
        except Exception as e:
            result['errors'].append(f"Soil: {str(e)}")
            print(f"⚠️  WARNING: {e}")
        
        # ===== STEP 5: VEGETATION CHARACTERISTICS =====
        print("\n[5/7] Vegetation Characteristics")
        print("-" * 70)
        try:
            veg_attrs = extract_vegetation_attributes(watershed['geometry'], gauge_id)
            result['attributes'].update(veg_attrs)
            print(f"✅ SUCCESS: Extracted {len(veg_attrs)} attributes")
        except Exception as e:
            result['errors'].append(f"Vegetation: {str(e)}")
            print(f"⚠️  WARNING: {e}")
        
        # ===== STEP 6: GEOLOGICAL CHARACTERISTICS =====
        print("\n[6/7] Geological Characteristics")
        print("-" * 70)
        try:
            geol_attrs = extract_geological_attributes(watershed['gdf'])
            result['attributes'].update(geol_attrs)
            print(f"✅ SUCCESS: Extracted {len(geol_attrs)} attributes")
        except Exception as e:
            result['errors'].append(f"Geology: {str(e)}")
            print(f"⚠️  WARNING: {e}")
        
        # ===== STEP 7: HYDROLOGICAL SIGNATURES =====
        print("\n[7/7] Hydrological Signatures")
        print("-" * 70)
        try:
            hydro_attrs = extract_hydrological_signatures(
                gauge_id,
                watershed['geometry'],
                hydro_dates[0],
                hydro_dates[1]
            )
            result['attributes'].update(hydro_attrs)
            print(f"✅ SUCCESS: Extracted {len(hydro_attrs)} attributes")
        except Exception as e:
            result['errors'].append(f"Hydrology: {str(e)}")
            print(f"⚠️  WARNING: {e}")
        
        # ===== FINALIZATION =====
        result['success'] = True
        
        print("\n" + "="*70)
        print("EXTRACTION COMPLETE")
        print("="*70)
        print(f"Total attributes extracted: {len(result['attributes'])}")
        print(f"Errors encountered: {len(result['errors'])}")
        
        # ===== OPTIONAL: SAVE RESULTS =====
        if save_results and output_dir:
            print(f"\nSaving results to: {output_dir}")
            result['files'] = _save_results(result, output_dir)
        
        return result
        
    except Exception as e:
        result['errors'].append(f"Fatal error: {str(e)}")
        print(f"\n❌ FATAL ERROR: {e}")
        return result


def _save_results(result: Dict, output_dir: str) -> Dict:
    """Save extraction results to files"""
    import os
    import json
    import pandas as pd
    
    os.makedirs(output_dir, exist_ok=True)
    gauge_id = result['gauge_id']
    
    files = {}
    
    try:
        # Save as CSV
        df = pd.DataFrame([result['attributes']])
        csv_path = os.path.join(output_dir, f"camels_attributes_{gauge_id}.csv")
        df.to_csv(csv_path, index=False)
        files['csv'] = csv_path
        print(f"    ✓ CSV: {csv_path}")
        
        # Save as JSON
        json_path = os.path.join(output_dir, f"camels_attributes_{gauge_id}.json")
        with open(json_path, 'w') as f:
            # Convert NaN values to null for valid JSON
            def clean_nan(obj):
                if isinstance(obj, dict):
                    return {k: clean_nan(v) for k, v in obj.items()}
                elif isinstance(obj, list):
                    return [clean_nan(item) for item in obj]
                elif isinstance(obj, float) and (obj != obj):  # Check for NaN
                    return None
                else:
                    return obj
            json.dump(clean_nan(result), f, indent=2, default=str)
        files['json'] = json_path
        print(f"    ✓ JSON: {json_path}")
        
    except Exception as e:
        print(f"    ⚠️  Warning: Could not save files: {e}")
    
    return files


# Example usage
if __name__ == "__main__":
    # Test with a known gauge
    test_gauge = "01031500"  # Penobscot River, Maine
    
    result = fetch_camels_attributes(
        test_gauge,
        save_results=True,
        output_dir="./test_camels_output"
    )
    
    if result['success']:
        print(f"\n✅ SUCCESS!")
        print(f"Extracted {len(result['attributes'])} attributes")
        if result['files']:
            print(f"Results saved to: {result['files'].get('csv')}")
    else:
        print(f"\n❌ FAILED with {len(result['errors'])} errors")
