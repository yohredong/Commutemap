import os
import geopandas as gpd
import pandas as pd
from pathlib import Path

# Setup paths
BASE_DIR = Path(__file__).parent.parent
INPUT_DIR = BASE_DIR / "GPX Cleanup/OUTPUT-GPKG File for QGIS Load"
OUTPUT_DIR = Path(__file__).parent / "data"
OUTPUT_FILE = OUTPUT_DIR / "routes.geojson"

# Create output folder if not exist
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

local_file = INPUT_DIR / "26.03.29 - Local Submission File.gpkg"
online_file = INPUT_DIR / "26.03.29 - Online Submission File.gpkg"

def process_file(file_path):
    if not file_path.exists():
        print(f"File not found: {file_path}")
        return None
    
    print(f"Reading: {file_path.name}")
    gdf = gpd.read_file(file_path)
    
    # Calculate distance in km if we reproject to a measured CRS (like EPSG:3857)
    # This ensures consistency for both files
    gdf_meters = gdf.to_crs("EPSG:3857")
    gdf['distance_km'] = gdf_meters.geometry.length / 1000.0
    
    # Fill empty names
    if 'name' not in gdf.columns:
        gdf['name'] = "Unnamed Route"
    else:
        gdf['name'] = gdf['name'].fillna("Unnamed Route")
        
    if 'type' not in gdf.columns:
        gdf['type'] = "cycling"
        
    # We only want to expose non-PII, basic attributes:
    columns_to_keep = ['name', 'type', 'distance_km', 'geometry']
    
    # Some older files might not have exact column matches, so intersect:
    columns_to_keep = [col for col in columns_to_keep if col in gdf.columns]
    
    # Guarantee geometry is kept
    if 'geometry' not in columns_to_keep:
        columns_to_keep.append('geometry')
        
    safe_gdf = gdf[columns_to_keep]
    return safe_gdf

def main():
    gdfs = []
    
    local_gdf = process_file(local_file)
    if local_gdf is not None:
        gdfs.append(local_gdf)
        
    online_gdf = process_file(online_file)
    if online_gdf is not None:
        gdfs.append(online_gdf)
        
    if not gdfs:
        print("No valid data found to process.")
        return
        
    # Merge datasets
    merged_gdf = pd.concat(gdfs, ignore_index=True)
    merged_gdf = gpd.GeoDataFrame(merged_gdf, geometry='geometry', crs=gdfs[0].crs)
    
    # Ensure it's in WGS84 for GeoJSON (web maps use lat/long)
    merged_gdf = merged_gdf.to_crs("EPSG:4326")
    
    # Save to GeoJSON, replacing if it exists
    if OUTPUT_FILE.exists():
        OUTPUT_FILE.unlink()
        
    merged_gdf.to_file(OUTPUT_FILE, driver="GeoJSON")
    print(f"Successfully processed {len(merged_gdf)} routes.")
    print(f"Output saved to: {OUTPUT_FILE}")

if __name__ == "__main__":
    main()
