// ─────────────────────────────────────────────────
// Pittsburgh-style basemap + KL Bicycle Routes
// ─────────────────────────────────────────────────

const map = new maplibregl.Map({
    container: 'map',
    style: 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json',
    center: [101.6869, 3.1390],
    zoom: 11,
    pitch: 0,
    bearing: 0,
    antialias: true
});

map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-right');
map.addControl(new maplibregl.ScaleControl({ maxWidth: 120 }), 'bottom-right');

// ─── Sidebar open / close ───────────────────────
const sidebar   = document.getElementById('sidebar');
const closeBtn  = document.getElementById('sidebar-close');
const toggleBtn = document.getElementById('sidebar-toggle');

closeBtn.addEventListener('click', () => {
    sidebar.classList.add('hidden');
    toggleBtn.style.display = 'flex';
});
toggleBtn.addEventListener('click', () => {
    sidebar.classList.remove('hidden');
    toggleBtn.style.display = 'none';
});

// ─── Color definitions ──────────────────────────

// Distinct colors for different contributors
const contributorPalette = [
    '#1565a0', // Blue
    '#c93d2a', // Red
    '#7a9e3e', // Green
    '#e67e22', // Orange
    '#8e44ad', // Purple
    '#2a8b8b', // Teal
    '#d35400', // Dark Orange
    '#27ae60', // Emerald Green
    '#2980b9', // Light Blue
    '#c0392b'  // Dark Red
];

// Stores the dynamic expressions after data loads
let colorByContributor = '#1565a0'; // Default setup
let colorByType = '#1565a0';
let colorByDistance = null;
let currentMode = 'type';   // 'type' | 'contributor' | 'distance'

function buildColorByDistance(minDist, maxDist) {
    // Use 'interpolate' across the distance_km property
    const mid1 = minDist + (maxDist - minDist) * 0.33;
    const mid2 = minDist + (maxDist - minDist) * 0.66;
    return [
        'interpolate', ['linear'],
        ['get', 'distance_km'],
        minDist, '#2ecc71',   // green  — short
        mid1,    '#f1c40f',   // yellow
        mid2,    '#e67e22',   // orange
        maxDist, '#e74c3c'    // red    — long
    ];
}

// ─── Apply a color mode to both route layers ────
function applyColorMode(mode) {
    let color = colorByType;
    if (mode === 'distance' && colorByDistance) color = colorByDistance;
    if (mode === 'contributor' && colorByContributor) color = colorByContributor;

    map.setPaintProperty('routes-halo', 'line-color', color);
    map.setPaintProperty('routes-core', 'line-color', color);

    currentMode = mode;

    // Toggle active button
    document.getElementById('viz-type').classList.toggle('active', mode === 'type');
    document.getElementById('viz-contributor').classList.toggle('active', mode === 'contributor');
    document.getElementById('viz-distance').classList.toggle('active', mode === 'distance');

    // Toggle legends
    document.getElementById('legend-type').style.display        = mode === 'type' ? '' : 'none';
    document.getElementById('legend-contributor').style.display = mode === 'contributor' ? '' : 'none';
    document.getElementById('legend-distance').style.display    = mode === 'distance' ? '' : 'none';
}

// ─── Map: layers & data ─────────────────────────
let hoveredRunId = null;

map.on('load', () => {

    // ── Tint basemap ──
    const bgLayers = map.getStyle().layers;
    for (const layer of bgLayers) {
        if (layer.id === 'background') {
            map.setPaintProperty('background', 'background-color', '#f3ede0');
        }
        if (layer.id === 'water') {
            map.setPaintProperty('water', 'fill-color', '#b8d8e8');
        }
        if (layer.id.includes('park') || layer.id.includes('landuse') && layer.type === 'fill') {
            try { map.setPaintProperty(layer.id, 'fill-color', '#c8dba5'); }
            catch (e) { /* skip */ }
        }
    }

    // ── Add GeoJSON source (cache-busted) ──
    const cacheBust = '?v=' + Date.now();
    map.addSource('commute-routes', {
        type: 'geojson',
        data: 'data/routes.geojson' + cacheBust,
        generateId: true
    });

    // Layer 1: Halo glow
    map.addLayer({
        id: 'routes-halo',
        type: 'line',
        source: 'commute-routes',
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: {
            'line-color': colorByType,
            'line-width': ['interpolate', ['linear'], ['zoom'], 10, 6, 15, 14],
            'line-blur':  ['interpolate', ['linear'], ['zoom'], 10, 3, 15, 8],
            'line-opacity': 0.30
        }
    });

    // Layer 2: Core line
    map.addLayer({
        id: 'routes-core',
        type: 'line',
        source: 'commute-routes',
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: {
            'line-color': colorByType,
            'line-width': ['interpolate', ['linear'], ['zoom'], 10, 2.5, 15, 6],
            'line-opacity': [
                'case',
                ['boolean', ['feature-state', 'hover'], false],
                1.0, 0.8
            ]
        }
    });

// ── Compute stats, gradients, and contributor colors ──
    fetch('data/routes.geojson' + cacheBust)
        .then(res => res.json())
        .then(data => {
            let totalDist = 0;
            let minDist = Infinity;
            let maxDist = -Infinity;
            const totalCount = data.features.length;

            const contributors = new Set();
            const transportTypes = new Set();

            if (totalCount > 0) {
                const bounds = new maplibregl.LngLatBounds();

                data.features.forEach(f => {
                    const props = f.properties;
                    const d = props.distance_km || 0;
                    totalDist += d;
                    if (d > 0) {
                        minDist = Math.min(minDist, d);
                        maxDist = Math.max(maxDist, d);
                    }

                    // Extract contributor
                    let c = props.contributor;
                    if (!c || c.trim() === '') c = 'Anonymous';
                    contributors.add(c);

                    // Extract type
                    let t = props.type;
                    if (!t || t.trim() === '') t = 'unknown';
                    transportTypes.add(t);

                    const walkCoords = (coords) => {
                        if (typeof coords[0] === 'number') bounds.extend(coords);
                        else coords.forEach(walkCoords);
                    };
                    walkCoords(f.geometry.coordinates);
                });

                // Update UI stats
                document.getElementById('total-routes').innerText = totalCount;
                document.getElementById('total-distance').innerText = totalDist.toFixed(1) + ' km';

                // Build the distance color expression
                if (minDist === Infinity) minDist = 0;
                if (maxDist === -Infinity) maxDist = 100;
                colorByDistance = buildColorByDistance(minDist, maxDist);

                // Build the contributor color expression & legend
                const uniqueContributors = Array.from(contributors).sort();
                const matchExprContrib = ['match', ['coalesce', ['get', 'contributor'], 'Anonymous']];
                let legendHtmlContrib = '';
                
                uniqueContributors.forEach((c, index) => {
                    const color = contributorPalette[index % contributorPalette.length];
                    matchExprContrib.push(c, color);
                    legendHtmlContrib += `
                        <div class="legend-item">
                            <span class="color-line" style="background: ${color};"></span>
                            <span>${c}</span>
                        </div>
                    `;
                });
                matchExprContrib.push('#6b6355'); // Default fallback color if no match
                colorByContributor = matchExprContrib;
                document.getElementById('contributor-legend-items').innerHTML = legendHtmlContrib;

                // Build the transport type color expression & legend
                const uniqueTypes = Array.from(transportTypes).sort();
                const matchExprType = ['match', ['coalesce', ['get', 'type'], 'unknown']];
                let legendHtmlType = '';
                
                let pIdx = 0;
                uniqueTypes.forEach(t => {
                    const lower = t.toLowerCase();
                    let color = '#7f8c8d'; // Grey default
                    if (lower === 'bicycle' || lower === 'cycling') color = '#1565a0';
                    else if (lower === 'walking') color = '#c93d2a';
                    else {
                        color = contributorPalette[pIdx % contributorPalette.length];
                        pIdx++;
                    }
                    matchExprType.push(t, color);
                    // Title case for legend
                    const label = t.charAt(0).toUpperCase() + t.slice(1);
                    legendHtmlType += `
                        <div class="legend-item">
                            <span class="color-line" style="background: ${color};"></span>
                            <span>${label}</span>
                        </div>
                    `;
                });
                matchExprType.push('#7f8c8d');
                colorByType = matchExprType;
                document.getElementById('type-legend-items').innerHTML = legendHtmlType;

                // Update gradient legend labels
                document.getElementById('dist-min').innerText = minDist.toFixed(1) + ' km';
                document.getElementById('dist-max').innerText = maxDist.toFixed(1) + ' km';

                // Apply initial layer styling now that expressions are built
                applyColorMode(currentMode);

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
            const rideName = props.name || 'Unnamed Route';
            const contributor = props.contributor && props.contributor !== 'Anonymous'
                ? props.contributor
                : 'Anonymous';
            const distance = props.distance_km
                ? parseFloat(props.distance_km).toFixed(2) + ' km'
                : 'N/A';
            const time = props.travel_time_min
                ? parseFloat(props.travel_time_min).toFixed(0) + ' min'
                : 'N/A';

            new maplibregl.Popup({ closeButton: true, closeOnClick: true })
                .setLngLat(e.lngLat)
                .setHTML(`
                    <div class="popup-title">${rideName}</div>
                    <div class="popup-detail">Contributor: <span>${contributor}</span></div>
                    <div class="popup-detail">Distance: <span>${distance}</span></div>
                    <div class="popup-detail">Travel Time: <span>${time}</span></div>
                `)
                .addTo(map);
        }
    });
});

// ─── Toggle button event listeners ──────────────
document.getElementById('viz-type').addEventListener('click', () => applyColorMode('type'));
document.getElementById('viz-contributor').addEventListener('click', () => applyColorMode('contributor'));
document.getElementById('viz-distance').addEventListener('click', () => applyColorMode('distance'));
