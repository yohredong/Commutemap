import glob
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

# Delete old GeoJSON
if OUTPUT_FILE.exists():
    OUTPUT_FILE.unlink()
    print(f"Deleted old {OUTPUT_FILE.name}")

# Find ALL .gpkg files in the directory
gpkg_files = sorted(INPUT_DIR.glob("*.gpkg"))

if not gpkg_files:
    print(f"No GPKG files found in {INPUT_DIR}")
    exit(1)

print(f"Found {len(gpkg_files)} GPKG file(s):")
for f in gpkg_files:
    print(f"  - {f.name}")

def process_file(file_path):
    print(f"\nProcessing: {file_path.name}")
    gdf = gpd.read_file(file_path)
    print(f"  Rows: {len(gdf)}, Columns: {list(gdf.columns)}")

    # Normalize column names: map known variations to standard names
    col_map = {}
    for col in gdf.columns:
        lower = col.lower().strip()
        if lower == 'name' or lower == 'full name':
            pass  # We'll handle name separately below
        if 'distance' in lower and 'km' in lower:
            col_map[col] = 'distance_km'
        if 'travel time' in lower or 'duration' in lower:
            col_map[col] = 'travel_time_min'
        if 'average speed' in lower or 'avg speed' in lower:
            col_map[col] = 'avg_speed_kmh'

    gdf = gdf.rename(columns=col_map)

    # Build a clean 'name' column
    if 'name' not in gdf.columns:
        gdf['name'] = "Unnamed Route"
    gdf['name'] = gdf['name'].fillna("Unnamed Route")

    # Build a 'type' column
    if 'type' not in gdf.columns:
        gdf['type'] = "cycling"
    gdf['type'] = gdf['type'].fillna("cycling")

    # Calculate distance if missing
    if 'distance_km' not in gdf.columns:
        gdf_meters = gdf.to_crs("EPSG:3857")
        gdf['distance_km'] = gdf_meters.geometry.length / 1000.0
    else:
        gdf['distance_km'] = pd.to_numeric(gdf['distance_km'], errors='coerce').fillna(0)

    # Keep only safe, non-PII columns
    safe_cols = ['name', 'type', 'distance_km', 'geometry']
    # Also keep travel_time_min and avg_speed_kmh if present
    for extra in ['travel_time_min', 'avg_speed_kmh']:
        if extra in gdf.columns:
            safe_cols.append(extra)

    safe_gdf = gdf[[c for c in safe_cols if c in gdf.columns]]
    print(f"  Kept columns: {list(safe_gdf.columns)}")
    return safe_gdf

gdfs = []
for f in gpkg_files:
    gdf = process_file(f)
    if gdf is not None and len(gdf) > 0:
        gdfs.append(gdf)

if not gdfs:
    print("No valid data found.")
    exit(1)

merged = pd.concat(gdfs, ignore_index=True)
merged = gpd.GeoDataFrame(merged, geometry='geometry', crs=gdfs[0].crs)
merged = merged.to_crs("EPSG:4326")

merged.to_file(OUTPUT_FILE, driver="GeoJSON")
print(f"\n✅ Saved {len(merged)} routes to {OUTPUT_FILE}")
