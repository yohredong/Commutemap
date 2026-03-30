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

    // ── Pre-load Unified Transit Source ──
    map.addSource('transit-data', {
        type: 'geojson',
        data: 'data/transit.geojson' + cacheBust
    });

    const getTransitColor = [
        'case',
        // Using substring matches against name or ref from OSM for BOTH lines and stations
        ['any', ['in', 'Kajang', ['string', ['coalesce', ['get', 'name'], ''], '']], ['in', 'KG', ['string', ['coalesce', ['get', 'name'], ''], '']], ['in', 'KG', ['string', ['coalesce', ['get', 'ref'], ''], '']]], '#008B45',
        ['any', ['in', 'Putrajaya', ['string', ['coalesce', ['get', 'name'], ''], '']], ['in', 'PY', ['string', ['coalesce', ['get', 'name'], ''], '']], ['in', 'PY', ['string', ['coalesce', ['get', 'ref'], ''], '']]], '#FFD700',
        ['any', ['in', 'Kelana', ['string', ['coalesce', ['get', 'name'], ''], '']], ['in', 'KJ', ['string', ['coalesce', ['get', 'name'], ''], '']], ['in', 'KJ', ['string', ['coalesce', ['get', 'ref'], ''], '']]], '#E31A7C',
        ['any', ['in', 'Ampang', ['string', ['coalesce', ['get', 'name'], ''], '']], ['in', 'AG', ['string', ['coalesce', ['get', 'name'], ''], '']], ['in', 'AG', ['string', ['coalesce', ['get', 'ref'], ''], '']]], '#FF8C00',
        ['any', ['in', 'Sri Petaling', ['string', ['coalesce', ['get', 'name'], ''], '']], ['in', 'SP', ['string', ['coalesce', ['get', 'name'], ''], '']], ['in', 'SP', ['string', ['coalesce', ['get', 'ref'], ''], '']]], '#8B0000',
        ['any', ['in', 'Monorel', ['string', ['coalesce', ['get', 'name'], ''], '']], ['in', 'MR', ['string', ['coalesce', ['get', 'name'], ''], '']], ['in', 'MR', ['string', ['coalesce', ['get', 'ref'], ''], '']]], '#8DB600',
        ['any', ['in', 'KTM', ['string', ['coalesce', ['get', 'network'], ''], '']], ['in', 'KA', ['string', ['coalesce', ['get', 'name'], ''], '']], ['in', 'KB', ['string', ['coalesce', ['get', 'name'], ''], '']], ['in', 'KC', ['string', ['coalesce', ['get', 'name'], ''], '']], ['in', 'KD', ['string', ['coalesce', ['get', 'name'], ''], '']]], '#0033A0',
        ['in', 'Express Rail Link', ['string', ['coalesce', ['get', 'network'], ''], '']], '#4B0082',
        '#95a5a6' // Generic fallback
    ];

    // Layer 0: Transit Lines (Behind commute lines)
    map.addLayer({
        id: 'transit-lines',
        type: 'line',
        source: 'transit-data',
        filter: ['==', ['geometry-type'], 'LineString'],
        layout: { 
            'line-join': 'round', 
            'line-cap': 'round',
            'visibility': 'visible' 
        },
        paint: {
            'line-width': ['interpolate', ['linear'], ['zoom'], 10, 2, 16, 5],
            'line-opacity': 0.35,
            'line-color': getTransitColor
        }
    });

    // Layer 0.5: Transit Stations
    map.addLayer({
        id: 'transit-stations',
        type: 'circle',
        source: 'transit-data',
        filter: ['==', ['geometry-type'], 'Point'],
        layout: {
            'visibility': 'visible'
        },
        paint: {
            'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 3, 15, 6],
            'circle-color': getTransitColor,
            'circle-stroke-color': '#ffffff',
            'circle-stroke-width': 1.5,
            'circle-opacity': 0.9
        }
    });

    // ── Station Interactive Rings ──
    map.addSource('station-rings', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] }
    });

    map.addLayer({
        id: 'station-rings-fill',
        type: 'fill',
        source: 'station-rings',
        layout: {},
        paint: {
            // Very subtle fill color
            'fill-color': '#3498db',
            'fill-opacity': 0.05
        }
    }, 'transit-lines'); // Add it beneath transit lines

    map.addLayer({
        id: 'station-rings-line',
        type: 'line',
        source: 'station-rings',
        layout: {},
        paint: {
            'line-color': '#2980b9',
            'line-width': 1.5,
            'line-dasharray': [2, 2],
            'line-opacity': 0.6
        }
    }, 'transit-lines');

    map.addLayer({
        id: 'station-rings-label',
        type: 'symbol',
        source: 'station-rings',
        filter: ['==', ['geometry-type'], 'LineString'],
        minzoom: 11, // Relaxed zoom requirement
        layout: {
            'text-field': ['get', 'label'],
            'text-font': ['Open Sans Regular', 'Arial Unicode MS Regular'],
            'text-size': ['interpolate', ['linear'], ['zoom'], 11, 10, 15, 12],
            'symbol-placement': 'line',
            'text-anchor': 'bottom',
            'text-offset': [0, 0.5],
            'text-padding': 2,
            'text-max-angle': 360,
            'text-keep-upright': true
        },
        paint: {
            'text-color': '#2c3e50',
            'text-halo-color': '#ffffff',
            'text-halo-width': 1.5
        }
    });

    // ── Transit Station Popups & Logic ──
    let activeStationPopup = null;
    let currentStationPopupId = null;
    let ringAnimationId = null;

    function animateRings(coords) {
        if (ringAnimationId) cancelAnimationFrame(ringAnimationId);
        
        const startTime = performance.now();
        const duration = 500; // milliseconds
        
        function frame(time) {
            let progress = (time - startTime) / duration;
            if (progress > 1) progress = 1;
            
            // Circular ease-out for a snappy but smooth ripple effect
            const ease = 1 - Math.pow(1 - progress, 3);
            
            const r1 = Math.max(0.001, 0.4 * ease);
            const r2 = Math.max(0.001, 1.0 * ease);
            const r3 = Math.max(0.001, 3.0 * ease);
            
            try {
                // Generate raw polygon rings for the fill layer
                const poly3km = turf.circle(coords, r3, { steps: 64 });
                const poly1km = turf.circle(coords, r2, { steps: 64 });
                const poly400m = turf.circle(coords, r1, { steps: 64 });
                
                // Generate discrete LineStrings for precise arc-labeling
                const line3km = turf.polygonToLine(poly3km);
                const line1km = turf.polygonToLine(poly1km);
                const line400m = turf.polygonToLine(poly400m);
                
                // Inject the responsive labels onto the lines once animation matures safely
                line3km.properties.label = progress > 0.3 ? '15 minutes by bike' : '';
                line1km.properties.label = progress > 0.3 ? '5 minutes by bike' : '';
                line400m.properties.label = progress > 0.3 ? '5 minute walk' : '';
                
                map.getSource('station-rings').setData(turf.featureCollection([
                    poly3km, poly1km, poly400m,
                    line3km, line1km, line400m
                ]));
            } catch (err) {
                // Safely ignore sub-millimeter turf interpolation math skips
            }
            
            if (progress < 1) {
                ringAnimationId = requestAnimationFrame(frame);
            }
        }
        
        ringAnimationId = requestAnimationFrame(frame);
    }

    map.on('click', 'transit-stations', (e) => {
        if (e.features.length > 0) {
            const props = e.features[0].properties;
            const coords = e.features[0].geometry.coordinates;
            const stationName = props.name || 'Unknown Station';
            
            // Unique ID to prevent active popup removal from wiping out new rings
            const popupId = Date.now();
            currentStationPopupId = popupId;
            
            // Clear previous popup (will fire 'close' on the old popup seamlessly)
            if (activeStationPopup) activeStationPopup.remove();
            
            // Re-order MapLibre layers so the rings and labels sit visibly on top of community routes
            if (map.getLayer('station-rings-fill')) map.moveLayer('station-rings-fill');
            if (map.getLayer('station-rings-line')) map.moveLayer('station-rings-line');
            if (map.getLayer('station-rings-label')) map.moveLayer('station-rings-label');
            if (map.getLayer('transit-stations')) map.moveLayer('transit-stations'); // Keep station points above the rings
            
            // Trigger customized geometric ripple radius generator
            animateRings(coords);

            // Compute a coordinate ~1.05km due North (0 degrees bearing) to anchor the popup just beyond the 1km ring!
            const popupAnchorCoords = turf.destination(coords, 1.05, 0, { units: 'kilometers' }).geometry.coordinates;

            activeStationPopup = new maplibregl.Popup({ 
                closeButton: true, 
                closeOnClick: true,
                anchor: 'bottom' // Let the popup sit above this calculated point
            })
                .setLngLat(popupAnchorCoords)
                .setHTML(`
                    <div style="font-weight: 600; font-size: 14px; margin-bottom: 4px;">${stationName}</div>
                    <div style="font-size: 12px; color: #666;">Transit Station</div>
                `)
                .addTo(map);
                
            activeStationPopup.on('close', () => {
                // ONLY explicitly wipe rings if the user closed THIS exact popup natively (e.g. clicking the map or "X")
                if (currentStationPopupId === popupId) {
                    if (ringAnimationId) cancelAnimationFrame(ringAnimationId);
                    map.getSource('station-rings').setData({ type: 'FeatureCollection', features: [] });
                    currentStationPopupId = null;
                }
            });
        }
    });
    
    map.on('mouseenter', 'transit-stations', () => map.getCanvas().style.cursor = 'pointer');
    map.on('mouseleave', 'transit-stations', () => map.getCanvas().style.cursor = '');

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
                        <label class="legend-item" style="cursor: pointer;">
                            <input type="checkbox" class="contrib-filter" value="${c}" checked>
                            <span class="color-line" style="background: ${color};"></span>
                            <span>${c}</span>
                        </label>
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
                        <label class="legend-item" style="cursor: pointer;">
                            <input type="checkbox" class="type-filter" value="${t}" checked>
                            <span class="color-line" style="background: ${color};"></span>
                            <span>${label}</span>
                        </label>
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

document.getElementById('toggle-transit').addEventListener('change', (e) => {
    const visibility = e.target.checked ? 'visible' : 'none';
    if (map.getLayer('transit-lines')) map.setLayoutProperty('transit-lines', 'visibility', visibility);
    if (map.getLayer('transit-stations')) map.setLayoutProperty('transit-stations', 'visibility', visibility);
});

// ── Unified Map Filtering Logic ──
const distSlider = document.getElementById('dist-category-slider');
const distCategoryLabel = document.getElementById('dist-category-label');

function updateAllFilters() {
    const filters = ['all'];

    // 1. Evaluate Distance Constraints
    const val = parseInt(distSlider.value);
    let category = "All Routes";
    if (val === 1) {
        category = "Short range commute (< 3km)";
        filters.push(['<', ['coalesce', ['get', 'distance_km'], 0], 3]);
    } else if (val === 2) {
        category = "Mid range commute (3km - 10km)";
        filters.push(['all', ['>=', ['coalesce', ['get', 'distance_km'], 0], 3], ['<', ['coalesce', ['get', 'distance_km'], 0], 10]]);
    } else if (val === 3) {
        category = "Long range commute (> 10km)";
        filters.push(['>=', ['coalesce', ['get', 'distance_km'], 0], 10]);
    }
    distCategoryLabel.innerText = category;

    // 2. Evaluate Contributor Constraints
    const constribNodes = document.querySelectorAll('.contrib-filter:checked');
    const allContribs = document.querySelectorAll('.contrib-filter');
    if (constribNodes.length < allContribs.length) {
        if (constribNodes.length === 0) {
            filters.push(['==', '1', '2']); // Hide all if 0 selected
        } else {
            const anyContrib = ['any'];
            constribNodes.forEach(cb => anyContrib.push(['==', ['coalesce', ['get', 'contributor'], 'Anonymous'], cb.value]));
            filters.push(anyContrib);
        }
    }

    // 3. Evaluate Transport Type Constraints
    const typeNodes = document.querySelectorAll('.type-filter:checked');
    const allTypes = document.querySelectorAll('.type-filter');
    if (typeNodes.length < allTypes.length) {
        if (typeNodes.length === 0) {
            filters.push(['==', '1', '2']); // Hide all
        } else {
            const anyType = ['any'];
            typeNodes.forEach(cb => anyType.push(['==', ['coalesce', ['get', 'type'], 'Unknown'], cb.value]));
            filters.push(anyType);
        }
    }

    // 4. Inject strict array expression into MapLibre pipeline
    const finalFilter = filters.length > 1 ? filters : null;
    if (map.getLayer('routes-halo')) map.setFilter('routes-halo', finalFilter);
    if (map.getLayer('routes-core')) map.setFilter('routes-core', finalFilter);
}

// Attach universally
distSlider.addEventListener('input', updateAllFilters);
document.getElementById('sidebar').addEventListener('change', (e) => {
    if (e.target.classList.contains('contrib-filter') || e.target.classList.contains('type-filter')) {
        updateAllFilters();
    }
});
