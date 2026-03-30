import sys
from pathlib import Path
import geopandas as gpd

def update_map_data():
    project_root = Path(__file__).resolve().parent.parent
    gpkg_dir = project_root / "GPX Cleanup" / "OUTPUT-GPKG File for QGIS Load"
    
    # Find the most recently modified GPKG file
    gpkg_files = list(gpkg_dir.glob("*.gpkg"))
    if not gpkg_files:
        print(f"Error: No GPKG files found in {gpkg_dir}")
        return
        
    latest_gpkg = max(gpkg_files, key=lambda f: f.stat().st_mtime)
    print(f"Reading latest GPKG database: {latest_gpkg.name}")
    
    try:
        gdf = gpd.read_file(latest_gpkg)
    except Exception as e:
        print(f"Failed to read GPKG: {e}")
        return
        
    # Map the raw Google Sheet column headers to the clean web-engine schema
    rename_map = {
        'Ride Name': 'name',
        'Full Name': 'contributor',
        'Mode of Transport': 'type',
        'Travel Time (Minutes)': 'travel_time_min',
        'Distance (km)': 'distance_km',
        'Average speed (km/h)': 'average_speed_kmh'
    }
    
    # Only try to rename columns that actually exist in the table
    existing_cols = {k: v for k, v in rename_map.items() if k in gdf.columns}
    gdf.rename(columns=existing_cols, inplace=True)
    
    # Enforce basic constraints for the web layer
    if 'type' in gdf.columns:
        gdf['type'] = gdf['type'].fillna('Unknown')
    if 'contributor' in gdf.columns:
        gdf['contributor'] = gdf['contributor'].fillna('Anonymous')
        
    out_file = project_root / "Online Map HTML" / "data" / "routes.geojson"
    try:
        gdf.to_file(out_file, driver='GeoJSON')
        print(f"Successfully converted and re-mapped {len(gdf)} route features!")
        print(f"Target updated: {out_file.relative_to(project_root)}")
    except Exception as e:
        print(f"Error saving GeoJSON: {e}")

if __name__ == "__main__":
    update_map_data()
