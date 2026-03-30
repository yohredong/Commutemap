import requests
import json
from pathlib import Path

def fetch_transit_data():
    overpass_url = "http://overpass-api.de/api/interpreter"
    
    
    query_lines = """
    [out:json][timeout:90];
    (
      way["railway"~"subway|light_rail|monorail"](2.6, 101.2, 3.6, 102.0);
      way["railway"="rail"]["usage"="main"](2.6, 101.2, 3.6, 102.0);
      way["railway"="rail"]["passenger"="yes"](2.6, 101.2, 3.6, 102.0);
    );
    out geom;
    """
    
    query_stations = """
    [out:json][timeout:90];
    (
      nwr["railway"~"station|halt"](2.6, 101.2, 3.6, 102.0);
      nwr["station"~"subway|light_rail|monorail"](2.6, 101.2, 3.6, 102.0);
    );
    out center;
    """
    
    import time
    
    def fetch_with_retry(query, desc="data", max_retries=5):
        print(f"Fetching {desc} from OpenStreetMap...")
        for attempt in range(max_retries):
            res = requests.post(overpass_url, data={'data': query})
            if res.status_code == 200:
                print(f"Successfully fetched {desc}.")
                return res.json()
            else:
                print(f"Server busy/error (Code: {res.status_code}). Retry {attempt + 1}/{max_retries} in {10 * (attempt + 1)}s...")
                time.sleep(10 * (attempt + 1))
        print(f"Failed to fetch {desc} after {max_retries} attempts.")
        return None

    data_lines = fetch_with_retry(query_lines, "transit lines")
    data_stations = fetch_with_retry(query_stations, "transit stations")
    
    if not data_lines or not data_stations:
        print("Error: Could not retrieve all necessary data. Please try again later.")
        return
    
    features = []
    
    # ─── Process Lines ───
    for el in data_lines.get('elements', []):
        if el['type'] != 'way': continue
        if 'geometry' not in el: continue
        tags = el.get('tags', {})
        
        name = tags.get('name', '')
        ref = tags.get('ref', '')
        network = tags.get('network', tags.get('operator', 'Unknown'))
        
        # Heavy rail within KL is owned by KTM. Force 'network' assignment if missing.
        if tags.get('railway') == 'rail':
            if network == 'Unknown' or not network:
                network = 'KTM'
        
        coords = [[pt['lon'], pt['lat']] for pt in el['geometry']]
        if len(coords) >= 2:
            features.append({
                "type": "Feature",
                "properties": {
                    "layer_type": "line",
                    "name": name,
                    "network": network,
                    "ref": ref
                },
                "geometry": {
                    "type": "LineString",
                    "coordinates": coords
                }
            })

    # ─── Process Stations ───
    seen_station_names = set()
    for el in data_stations.get('elements', []):
        # We process 'center' tags because we used 'out center;' on polygons
        lat = el.get('lat') or (el.get('center', {}).get('lat'))
        lon = el.get('lon') or (el.get('center', {}).get('lon'))
        
        if not lat or not lon: continue
        
        tags = el.get('tags', {})
        name = tags.get('name')
        if not name: continue
        
        # Deduplicate
        if name in seen_station_names: continue
        seen_station_names.add(name)
        
        features.append({
            "type": "Feature",
            "properties": {
                "layer_type": "station",
                "name": name,
                "network": tags.get('network', tags.get('operator', '')),
                "ref": tags.get('ref', '')
            },
            "geometry": {
                "type": "Point",
                "coordinates": [lon, lat]
            }
        })
                
    # ─── Save GeoJSON ───
    out_dir = Path(__file__).parent / "data"
    out_dir.mkdir(parents=True, exist_ok=True)
    
    file_unified = out_dir / "transit.geojson"
    with open(file_unified, 'w') as f:
        json.dump({"type": "FeatureCollection", "features": features}, f)
        
    print(f"Successfully saved {len(features)} total transit features to {file_unified}")

if __name__ == "__main__":
    fetch_transit_data()
