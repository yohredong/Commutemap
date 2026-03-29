// ─────────────────────────────────────────────────
// Pittsburgh-style basemap + KL Bicycle Routes
// ─────────────────────────────────────────────────

// Use the Carto Positron (light) style as a starting point —
// it is closest to the warm, clean aesthetic of the Pittsburgh map.
const map = new maplibregl.Map({
    container: 'map',
    style: 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json',
    center: [101.6869, 3.1390],  // Kuala Lumpur
    zoom: 11,
    pitch: 0,
    bearing: 0,
    antialias: true
});

// Navigation controls
map.addControl(new maplibregl.NavigationControl({
    visualizePitch: true
}), 'top-right');

// Scale bar
map.addControl(new maplibregl.ScaleControl({ maxWidth: 120 }), 'bottom-right');

// ─── Sidebar open / close ───────────────────────
const sidebar      = document.getElementById('sidebar');
const closeBtn     = document.getElementById('sidebar-close');
const toggleBtn    = document.getElementById('sidebar-toggle');

closeBtn.addEventListener('click', () => {
    sidebar.classList.add('hidden');
    toggleBtn.style.display = 'flex';
});

toggleBtn.addEventListener('click', () => {
    sidebar.classList.remove('hidden');
    toggleBtn.style.display = 'none';
});

// ─── Map: layers & data ─────────────────────────
let hoveredRunId = null;

map.on('load', () => {

    // ── Tint the basemap to get a warmer, cream feel ──
    // Positron roads are light grey; we keep them as-is.
    // We nudge the background layer color to a subtle cream.
    const bgLayers = map.getStyle().layers;
    for (const layer of bgLayers) {
        if (layer.id === 'background') {
            map.setPaintProperty('background', 'background-color', '#f3ede0');
        }
        // Tint water to a softer blue like the Pittsburgh map
        if (layer.id === 'water') {
            map.setPaintProperty('water', 'fill-color', '#b8d8e8');
        }
        // Tint parks / green areas
        if (layer.id.includes('park') || layer.id.includes('landuse') && layer.type === 'fill') {
            try {
                map.setPaintProperty(layer.id, 'fill-color', '#c8dba5');
            } catch (e) { /* some layers may not support this – skip */ }
        }
    }

    // ── Add GeoJSON source (cache-busted) ──
    const cacheBust = '?v=' + Date.now();
    map.addSource('commute-routes', {
        type: 'geojson',
        data: 'data/routes.geojson' + cacheBust,
        generateId: true
    });

    // Layer 1: Wider "halo" glow behind each line (for visibility)
    map.addLayer({
        id: 'routes-halo',
        type: 'line',
        source: 'commute-routes',
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: {
            'line-color': [
                'match', ['get', 'type'],
                'walking', '#c93d2a',
                '#1565a0'   // cycling
            ],
            'line-width': [
                'interpolate', ['linear'], ['zoom'],
                10, 6,
                15, 14
            ],
            'line-blur': [
                'interpolate', ['linear'], ['zoom'],
                10, 3,
                15, 8
            ],
            'line-opacity': 0.30
        }
    });

    // Layer 2: Solid core line (the main visible route)
    map.addLayer({
        id: 'routes-core',
        type: 'line',
        source: 'commute-routes',
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: {
            'line-color': [
                'match', ['get', 'type'],
                'walking', '#c93d2a',
                '#1565a0'
            ],
            'line-width': [
                'interpolate', ['linear'], ['zoom'],
                10, 2.5,
                15, 6
            ],
            'line-opacity': [
                'case',
                ['boolean', ['feature-state', 'hover'], false],
                1.0,
                0.8
            ]
        }
    });

    // ── Compute stats & fit bounds ──
    fetch('data/routes.geojson' + cacheBust)
        .then(res => res.json())
        .then(data => {
            let totalDist = 0;
            const totalCount = data.features.length;

            if (totalCount > 0) {
                const bounds = new maplibregl.LngLatBounds();

                data.features.forEach(f => {
                    if (f.properties.distance_km) totalDist += f.properties.distance_km;

                    const walkCoords = (coords) => {
                        if (typeof coords[0] === 'number') {
                            bounds.extend(coords);
                        } else {
                            coords.forEach(walkCoords);
                        }
                    };
                    walkCoords(f.geometry.coordinates);
                });

                document.getElementById('total-routes').innerText = totalCount;
                document.getElementById('total-distance').innerText = totalDist.toFixed(1) + ' km';

                map.fitBounds(bounds, {
                    padding: { top: 50, bottom: 50, left: 380, right: 50 },
                    maxZoom: 14,
                    duration: 2000
                });
            }
        })
        .catch(err => console.error("Could not load GeoJSON:", err));

    // ── Hover interaction ──
    map.on('mousemove', 'routes-core', (e) => {
        map.getCanvas().style.cursor = 'pointer';
        if (e.features.length > 0) {
            if (hoveredRunId !== null) {
                map.setFeatureState({ source: 'commute-routes', id: hoveredRunId }, { hover: false });
            }
            hoveredRunId = e.features[0].id;
            map.setFeatureState({ source: 'commute-routes', id: hoveredRunId }, { hover: true });
        }
    });

    map.on('mouseleave', 'routes-core', () => {
        map.getCanvas().style.cursor = '';
        if (hoveredRunId !== null) {
            map.setFeatureState({ source: 'commute-routes', id: hoveredRunId }, { hover: false });
        }
        hoveredRunId = null;
    });

    // ── Click → popup ──
    map.on('click', 'routes-core', (e) => {
        if (e.features.length > 0) {
            const props = e.features[0].properties;
            const routeName = props.name || 'Unnamed Route';
            const routeType = props.type
                ? props.type.charAt(0).toUpperCase() + props.type.slice(1)
                : 'Unknown';
            const distance = props.distance_km
                ? parseFloat(props.distance_km).toFixed(2) + ' km'
                : 'N/A';

            new maplibregl.Popup({ closeButton: true, closeOnClick: true })
                .setLngLat(e.lngLat)
                .setHTML(`
                    <div class="popup-title">${routeName}</div>
                    <div class="popup-detail">Type: <span>${routeType}</span></div>
                    <div class="popup-detail">Distance: <span>${distance}</span></div>
                `)
                .addTo(map);
        }
    });
});
