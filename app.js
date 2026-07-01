// ─────────────────────────────────────────────────
// Pittsburgh-style basemap + KL Bicycle Routes
// ─────────────────────────────────────────────────

// ── Basemap raster tile sources ──
// All 4 basemaps are loaded as raster sources on startup.
// Switching basemaps just toggles layer visibility — custom layers are NEVER removed.
const BASEMAP_TILES = {
    light:     'https://basemaps.cartocdn.com/rastertiles/light_all/{z}/{x}/{y}@2x.png',
    dark:      'https://basemaps.cartocdn.com/rastertiles/dark_all/{z}/{x}/{y}@2x.png',
    terrain:   'https://basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}@2x.png',
    satellite: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'
};
const BASEMAP_LAYER_IDS = Object.keys(BASEMAP_TILES).map(k => 'basemap-' + k);

let currentBasemap = 'light';

// Start with a blank style — basemap tiles are added as raster sources in initMapLayers()
const map = new maplibregl.Map({
    container: 'map',
    style: {
        version: 8,
        glyphs: 'https://fonts.openmaptiles.org/{fontstack}/{range}.pbf',
        sources: {},
        layers: []
    },
    center: [101.6869, 3.1390],
    zoom: 11,
    pitch: 0,
    bearing: 0,
    antialias: true
});

// ─── Mobile fullscreen: keep map canvas in sync with visible viewport ───
// iOS Safari reports window.innerHeight incorrectly on load (includes browser chrome).
// visualViewport fires when the chrome slides away; window resize fires on orientation change.
(function fixMobileFullscreen() {
    let resizeTimer;
    function onViewportChange() {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => {
            // Force MapLibre to recalculate canvas size against real visible area
            map.resize();
        }, 100);
    }

    // visualViewport API — fires when iOS chrome collapses/expands
    if (window.visualViewport) {
        window.visualViewport.addEventListener('resize', onViewportChange);
        window.visualViewport.addEventListener('scroll', onViewportChange);
    }

    // Fallback: standard resize (orientation changes, desktop resize)
    window.addEventListener('resize', onViewportChange);

    // Also flush once the map is fully loaded to catch any initial chrome mismatch
    map.once('load', () => { map.resize(); });
}());


map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-right');
map.addControl(new maplibregl.ScaleControl({ maxWidth: 120 }), 'bottom-right');

// ─── Zoom to user location on load ───────────────
if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(
        (pos) => {
            map.flyTo({
                center: [pos.coords.longitude, pos.coords.latitude],
                zoom: 13,
                speed: 1.2,
                essential: true
            });
        },
        () => { /* silently fall back to default KL centre */ },
        { enableHighAccuracy: false, timeout: 6000 }
    );
}

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

// Stores the dynamic expressions after data loads
let colorByType = '#1565a0';
let colorByDistance = null;
let currentMode = 'type';   // 'type' | 'distance'

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

// ── Resolve the JS color for a given feature based on current vis mode ──
function resolveFeatureColor(props) {
    if (currentMode === 'distance' && colorByDistance) {
        const d = parseFloat(props.distance_km) || 0;
        if (d < 3) return '#2ecc71';
        if (d < 10) return '#f1c40f';
        return '#e74c3c';
    }
    // By type (default)
    const t = (props.type || '').toLowerCase();
    if (t.includes('cycle') || t.includes('bicycle')) return '#1565a0';
    if (t.includes('walk')) return '#c93d2a';
    if (t.includes('scooter') || t.includes('electric')) return '#8e44ad';
    return '#7f8c8d';
}

// ─── Apply a color mode to both route layers ────
function applyColorMode(mode) {
    let color = colorByType;
    if (mode === 'distance' && colorByDistance) color = colorByDistance;

    map.setPaintProperty('routes-halo', 'line-color', color);
    map.setPaintProperty('routes-core', 'line-color', color);
    if (map.getLayer('selected-route')) {
        map.setPaintProperty('selected-route', 'line-color', color);
    }

    currentMode = mode;

    // Toggle active button
    document.getElementById('viz-type').classList.toggle('active', mode === 'type');
    document.getElementById('viz-distance').classList.toggle('active', mode === 'distance');

    // Toggle legends
    document.getElementById('legend-type').style.display     = mode === 'type'     ? '' : 'none';
    document.getElementById('legend-distance').style.display = mode === 'distance' ? '' : 'none';
}

// ─── Map: layers & data ─────────────────────────
let hoveredRunId = null;

// ─── Master layer initialiser (called ONCE on map load) ───
function initMapLayers() {

    // ── 1. Add raster basemap layers (all 4, only 'light' visible initially) ──
    Object.entries(BASEMAP_TILES).forEach(([key, tileUrl]) => {
        const sourceId = 'basemap-src-' + key;
        const layerId  = 'basemap-' + key;
        map.addSource(sourceId, {
            type: 'raster',
            tiles: [tileUrl],
            tileSize: 256,
            attribution: key === 'satellite' ? 'Tiles © Esri' : '© CARTO'
        });
        map.addLayer({
            id: layerId,
            type: 'raster',
            source: sourceId,
            layout: { visibility: key === currentBasemap ? 'visible' : 'none' }
        });
    });

    // ── 2. Add GeoJSON sources (cache-busted) ──
    const cacheBust = '?v=' + Date.now();
    map.addSource('commute-routes', {
        type: 'geojson',
        data: 'data/routes.geojson' + cacheBust,
        generateId: true
    });
    map.addSource('transit-data', {
        type: 'geojson',
        data: 'data/transit.geojson' + cacheBust
    });
    map.addSource('dbkl-routes', {
        type: 'geojson',
        data: 'data/dbkl_routes.geojson' + cacheBust
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

    // Layer 0.5: Transit Stations (coloured circle background)
    map.addLayer({
        id: 'transit-stations',
        type: 'circle',
        source: 'transit-data',
        filter: ['==', ['geometry-type'], 'Point'],
        layout: {
            'visibility': 'visible'
        },
        paint: {
            'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 7, 15, 13],
            'circle-color': getTransitColor,
            'circle-stroke-color': '#ffffff',
            'circle-stroke-width': 1.5,
            'circle-opacity': 0.9
        }
    });

    // Layer 0.6: Train station icon on top of each circle
    map.loadImage('Train-station-Icon.png', (err, img) => {
        if (err) { console.warn('Could not load Train-station-Icon.png:', err); return; }
        if (!map.hasImage('train-station-icon')) {
            map.addImage('train-station-icon', img);
        }
        // Icon layer — collision detection ON so icons sit side-by-side instead of stacking
        map.addLayer({
            id: 'transit-station-icons',
            type: 'symbol',
            source: 'transit-data',
            minzoom: 11,
            filter: ['==', ['geometry-type'], 'Point'],
            layout: {
                'visibility': 'visible',
                'icon-image': 'train-station-icon',
                'icon-size': ['interpolate', ['linear'], ['zoom'], 11, 0.020, 13, 0.030, 15, 0.042],
                // Collision detection ON: icons sit adjacent, not stacked.
                // Icons that can't fit at the current zoom are deferred until you zoom in.
                'icon-padding': 10,
                'symbol-spacing': 16,

                // Station name labels appear at zoom ≥ 13
                'text-field': ['step', ['zoom'], '', 13, ['coalesce', ['get', 'name'], '']],
                'text-font': ['Open Sans SemiBold', 'Arial Unicode MS Bold'],
                'text-size': ['interpolate', ['linear'], ['zoom'], 13, 9, 16, 12],
                'text-anchor': 'top',
                'text-offset': [0, 1.6],
                'text-max-width': 8,
                'text-padding': 4,
                'text-allow-overlap': false,
                'text-optional': true
            },
            paint: {
                'text-color': '#2c3e50',
                'text-halo-color': '#ffffff',
                'text-halo-width': 1.5
            }
        }, 'routes-halo');
    });

    // ── Station Interactive Rings ──
    if (!map.getSource('station-rings')) {
        map.addSource('station-rings', {
            type: 'geojson',
            data: { type: 'FeatureCollection', features: [] }
        });
    }

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

    // ── Active Route Tracker Layers ──
    if (!map.getSource('active-route-meta')) {
        map.addSource('active-route-meta', {
            type: 'geojson',
            data: { type: 'FeatureCollection', features: [] }
        });
    }

    // 1. Endpoint Circles (color matches route, white stroke)
    map.addLayer({
        id: 'active-route-endpoints',
        type: 'circle',
        source: 'active-route-meta',
        filter: ['in', ['get', 'type'], ['literal', ['start', 'end']]],
        paint: {
            'circle-radius': 10,
            'circle-color': ['get', 'routeColor'],
            'circle-stroke-color': '#ffffff',
            'circle-stroke-width': 2.5
        }
    });

    // 1b. Endpoint Labels (S / E)
    map.addLayer({
        id: 'active-route-endpoint-labels',
        type: 'symbol',
        source: 'active-route-meta',
        filter: ['in', ['get', 'type'], ['literal', ['start', 'end']]],
        layout: {
            'text-field': ['get', 'label'],
            'text-size': 11,
            'text-font': ['Open Sans Bold', 'Arial Unicode MS Bold'],
            'text-allow-overlap': true,
            'text-ignore-placement': true
        },
        paint: { 'text-color': '#ffffff' }
    });

    // ── Hover Preview Layers (desktop only, lighter effect) ──
    if (!map.getSource('hover-route-meta')) {
        map.addSource('hover-route-meta', {
            type: 'geojson',
            data: { type: 'FeatureCollection', features: [] }
        });
    }

    map.addLayer({
        id: 'hover-route-endpoints',
        type: 'circle',
        source: 'hover-route-meta',
        filter: ['in', ['get', 'type'], ['literal', ['start', 'end']]],
        paint: {
            'circle-radius': 8,
            'circle-color': ['get', 'routeColor'],
            'circle-stroke-color': '#ffffff',
            'circle-stroke-width': 2
        }
    });

    map.addLayer({
        id: 'hover-route-endpoint-labels',
        type: 'symbol',
        source: 'hover-route-meta',
        filter: ['in', ['get', 'type'], ['literal', ['start', 'end']]],
        layout: {
            'text-field': ['get', 'label'],
            'text-size': 10,
            'text-font': ['Open Sans Bold', 'Arial Unicode MS Bold'],
            'text-allow-overlap': true,
            'text-ignore-placement': true
        },
        paint: { 'text-color': '#ffffff' }
    });

    // 2. Midpoint Transport Icon (Emoji)
    map.addLayer({
        id: 'active-route-midpoint',
        type: 'symbol',
        source: 'active-route-meta',
        filter: ['==', ['get', 'type'], 'midpoint'],
        layout: {
            'text-field': ['get', 'icon'],
            'text-size': 24,
            'text-allow-overlap': true,
            'text-ignore-placement': true
        },
        paint: {
            'text-halo-color': '#ffffff',
            'text-halo-width': 2
        }
    });

    // 3. Directional Tracking Arrows (animated)
    map.addLayer({
        id: 'active-route-arrows',
        type: 'symbol',
        source: 'active-route-meta',
        filter: ['==', ['get', 'type'], 'arrow'],
        layout: {
            'text-field': '▶',
            'text-size': 18,
            'symbol-placement': 'point',
            'text-rotation-alignment': 'map',
            'text-rotate': ['get', 'bearing'],
            'text-allow-overlap': true,
            'text-ignore-placement': true
        },
        paint: {
            'text-color': '#ffffff',
            'text-halo-color': ['get', 'routeColor'],
            'text-halo-width': 2
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
            if (map.getLayer('transit-stations'))      map.moveLayer('transit-stations');      // Keep station circles above the rings
            if (map.getLayer('transit-station-icons')) map.moveLayer('transit-station-icons'); // Keep icons above the circles
            
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

    // ── DBKL Route Layers (rendered below community routes) ──
    // Color expression matching the original DBKL 2026 Bike Map:
    //   #1A237E  → Existing routes (deep navy)
    //   #0288D1  → Planned / Pelan Induk (sky blue)
    //   #B2EBF2  → GDCI / Waterfront paths (light cyan)
    //   #F50000  → Missing Links (red)
    //   #FF0000  → Missing Link variant (bright red)
    //   #FF00FF  → Proposed Connection (magenta)
    //   #BDBDBD  → Contextual / reference (grey)
    const dbklColor = [
        'match', ['coalesce', ['get', 'kml_color'], '0288D1'],
        '1A237E', '#1A237E',   // Existing Route — deep navy
        '0288D1', '#0288D1',   // Planned Route  — sky blue
        'B2EBF2', '#48c4d4',   // GDCI/Waterfront — vivid cyan (brightened for visibility)
        'F50000', '#f43f3f',   // Missing Link   — red
        'FF0000', '#f43f3f',   // Missing Link   — red variant
        'FF00FF', '#dd00ff',   // Proposed Connection — magenta
        'BDBDBD', '#9e9e9e',   // Contextual     — grey
        '#0288D1'              // default fallback
    ];

    // ── DBKL Polygon layers (area zones: Pelan Induk, Park Bike Routes) ──
    map.addLayer({
        id: 'dbkl-polygons-fill',
        type: 'fill',
        source: 'dbkl-routes',
        filter: ['all', ['==', ['geometry-type'], 'Polygon'], ['==', ['get', 'route_type'], 'Existing Route']],
        layout: { 'visibility': 'visible' },
        paint: {
            'fill-color': dbklColor,
            'fill-opacity': 0.12
        }
    });

    map.addLayer({
        id: 'dbkl-polygons-outline',
        type: 'line',
        source: 'dbkl-routes',
        filter: ['all', ['==', ['geometry-type'], 'Polygon'], ['==', ['get', 'route_type'], 'Existing Route']],
        layout: { 'line-join': 'round', 'visibility': 'visible' },
        paint: {
            'line-color': dbklColor,
            'line-width': 2,
            'line-dasharray': [4, 2],
            'line-opacity': 0.7
        }
    });

    // Halo: soft glow — Existing Routes only
    map.addLayer({
        id: 'dbkl-routes-halo',
        type: 'line',
        source: 'dbkl-routes',
        filter: ['all', ['==', ['geometry-type'], 'LineString'], ['==', ['get', 'route_type'], 'Existing Route']],
        layout: { 'line-join': 'round', 'line-cap': 'round', 'visibility': 'visible' },
        paint: {
            'line-color': dbklColor,
            'line-width': ['interpolate', ['linear'], ['zoom'], 10, 8, 15, 18],
            'line-blur':  ['interpolate', ['linear'], ['zoom'], 10, 4, 15, 10],
            'line-opacity': 0.28
        }
    });

    // Core: dashed line — Existing Routes only
    map.addLayer({
        id: 'dbkl-routes-core',
        type: 'line',
        source: 'dbkl-routes',
        filter: ['all', ['==', ['geometry-type'], 'LineString'], ['==', ['get', 'route_type'], 'Existing Route']],
        layout: { 'line-join': 'round', 'line-cap': 'round', 'visibility': 'visible' },
        paint: {
            'line-color': dbklColor,
            'line-width': ['interpolate', ['linear'], ['zoom'], 10, 2, 15, 5],
            'line-dasharray': [4, 2],
            'line-opacity': 0.9
        }
    });

    // Layer 0: White isolation overlay (world polygon, initially hidden)
    // Lives INSIDE WebGL so selected-route can render above it
    if (!map.getSource('isolation-bg')) {
        map.addSource('isolation-bg', {
            type: 'geojson',
            data: {
                type: 'Feature',
                geometry: {
                    type: 'Polygon',
                    coordinates: [[[-180,-90],[180,-90],[180,90],[-180,90],[-180,-90]]]
                }
            }
        });
    }
    map.addLayer({
        id: 'route-isolation-bg',
        type: 'fill',
        source: 'isolation-bg',
        paint: {
            'fill-color': '#ffffff',
            'fill-opacity': 0,  // hidden by default, activated on route hover/click
            'fill-opacity-transition': { duration: 0, delay: 0 }  // instant — no fade delay
        }
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

    // Layer 2b: Invisible wide touch-target layer — makes routes easy to tap on mobile
    // Visually transparent (opacity 0) but intercepts pointer events over a ~20px band
    map.addLayer({
        id: 'routes-touch',
        type: 'line',
        source: 'commute-routes',
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: {
            'line-color': '#000000',
            'line-width': 20,
            'line-opacity': 0
        }
    });

    // Layer 3: Selected route highlight — moved above isolation-bg on click
    map.addLayer({
        id: 'selected-route',
        type: 'line',
        source: 'commute-routes',
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        filter: ['==', ['id'], ''],  // starts with nothing selected
        paint: {
            'line-color': colorByType,
            'line-width': ['interpolate', ['linear'], ['zoom'], 10, 6, 15, 10],
            'line-opacity': 1.0
        }
    });

    // Layer 3b: Hovered route highlight — updated on mousemove (desktop)
    map.addLayer({
        id: 'hover-route-highlight',
        type: 'line',
        source: 'commute-routes',
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        filter: ['==', ['id'], ''],  // starts empty, set dynamically on hover
        paint: {
            'line-color': colorByType,
            'line-width': ['interpolate', ['linear'], ['zoom'], 10, 6, 15, 10],
            'line-opacity': 1.0
        }
    });


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
                document.getElementById('total-routes').innerText       = totalCount;
                document.getElementById('total-distance').innerText     = totalDist.toFixed(1) + ' km';
                document.getElementById('total-contributors').innerText = contributors.size;

                // Build the distance color expression
                if (minDist === Infinity) minDist = 0;
                if (maxDist === -Infinity) maxDist = 100;
                colorByDistance = buildColorByDistance(minDist, maxDist);

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
                        // Use a simple index-based palette for other types
                        const extraPalette = ['#e67e22','#8e44ad','#2a8b8b','#d35400','#27ae60'];
                        color = extraPalette[pIdx % extraPalette.length];
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

    // ── Hover interaction (core + touch layer) ──
    // isDesktop: true for mouse/trackpad devices that support CSS :hover
    const isDesktop = window.matchMedia('(hover: hover) and (pointer: fine)').matches;

    const handleRouteHoverEnter = (e) => {
        map.getCanvas().style.cursor = 'pointer';
        if (e.features.length > 0) {
            if (hoveredRunId !== null) {
                map.setFeatureState({ source: 'commute-routes', id: hoveredRunId }, { hover: false });
            }
            hoveredRunId = e.features[0].id;
            map.setFeatureState({ source: 'commute-routes', id: hoveredRunId }, { hover: true });

            // Desktop-only: highlight line + S/E markers + light overlay
            if (isDesktop) {
                const f = e.features[0];
                const hoverColor = resolveFeatureColor(f.properties);

                // 1. Highlight the hovered route above the white fill
                if (map.getLayer('hover-route-highlight')) {
                    map.setFilter('hover-route-highlight', ['==', ['id'], hoveredRunId]);
                }

                // 2. Compute and place S/E markers
                let coords = f.geometry.coordinates;
                if (f.geometry.type === 'MultiLineString') {
                    coords = coords.reduce((acc, val) => acc.concat(val), []);
                }
                try {
                    const ls      = turf.lineString(coords);
                    const lineLen = turf.length(ls, { units: 'meters' });
                    const startPt = turf.along(ls, 0, { units: 'meters' });
                    const endPt   = turf.along(ls, lineLen, { units: 'meters' });
                    startPt.properties = { type: 'start', label: 'S', routeColor: hoverColor };
                    endPt.properties   = { type: 'end',   label: 'E', routeColor: hoverColor };
                    map.getSource('hover-route-meta').setData(turf.featureCollection([startPt, endPt]));
                } catch(err) {}

                // 3. Show lighter overlay only when no route is already selected
                if (selectedFeatureId === null) {
                    map.setPaintProperty('route-isolation-bg', 'fill-opacity', 0.40);
                    if (map.getLayer('route-isolation-bg'))    map.moveLayer('route-isolation-bg');
                    if (map.getLayer('hover-route-highlight')) map.moveLayer('hover-route-highlight');
                }
                // 4. Bring S/E markers to top
                if (map.getLayer('hover-route-endpoints'))       map.moveLayer('hover-route-endpoints');
                if (map.getLayer('hover-route-endpoint-labels')) map.moveLayer('hover-route-endpoint-labels');
            }
        }
    };

    const handleRouteHoverLeave = () => {
        map.getCanvas().style.cursor = '';
        if (hoveredRunId !== null) {
            map.setFeatureState({ source: 'commute-routes', id: hoveredRunId }, { hover: false });
        }
        hoveredRunId = null;

        // Desktop: clear hover highlight, markers and reset overlay (unless a route is selected)
        if (isDesktop) {
            // Reset hovered route highlight filter to show nothing
            if (map.getLayer('hover-route-highlight')) {
                map.setFilter('hover-route-highlight', ['==', ['id'], '']);
            }
            if (map.getSource('hover-route-meta')) {
                map.getSource('hover-route-meta').setData({ type: 'FeatureCollection', features: [] });
            }
            if (selectedFeatureId === null) {
                map.setPaintProperty('route-isolation-bg', 'fill-opacity', 0);
            }
        }
    };

    // Export hover handlers globally so they can be bound outside
    window._handleRouteHoverEnter = handleRouteHoverEnter;
    window._handleRouteHoverLeave = handleRouteHoverLeave;

    // ── Route click state ──
    const routeOverlay  = document.getElementById('route-overlay');
    const detailPanel   = document.getElementById('route-detail-panel');
    const detailClose   = document.getElementById('route-detail-close');
    let selectedFeatureId = null;
    let activeRouteAnimationId = null;

    function animateActiveRoute(routeFeature, transportType, routeColor) {
        if (activeRouteAnimationId) cancelAnimationFrame(activeRouteAnimationId);
        let coordinates = routeFeature.geometry.coordinates;
        if (routeFeature.geometry.type === 'MultiLineString') {
            coordinates = coordinates.reduce((acc, val) => acc.concat(val), []);
        }
        let cleanFeature;
        try { cleanFeature = turf.lineString(coordinates); }
        catch(e) { console.error('Turf failed:', e); return; }

        const lineLen = turf.length(cleanFeature, { units: 'meters' });
        const startPt = turf.along(cleanFeature, 0, { units: 'meters' });
        const endPt   = turf.along(cleanFeature, lineLen, { units: 'meters' });
        const midPt   = turf.along(cleanFeature, lineLen / 2, { units: 'meters' });

        startPt.properties = { type: 'start', label: 'S', routeColor };
        endPt.properties   = { type: 'end',   label: 'E', routeColor };

        let icon = '📍';
        const tLower = (transportType || '').toLowerCase();
        if (tLower.includes('cycle') || tLower.includes('bicycle')) icon = '🚴';
        else if (tLower.includes('walk')) icon = '🚶';
        else if (tLower.includes('scooter') || tLower.includes('electric')) icon = '⚡';
        midPt.properties = { type: 'midpoint', icon };

        const numArrows = Math.max(1, Math.floor(lineLen / 800));
        const duration  = 6000;

        function frame(time) {
            const features = [startPt, endPt, midPt];
            for (let i = 0; i < numArrows; i++) {
                const d = (i * (lineLen / numArrows) + ((time % duration) / duration) * (lineLen / numArrows)) % lineLen;
                try {
                    const arrowPt = turf.along(cleanFeature, d, { units: 'meters' });
                    const nextPt  = turf.along(cleanFeature, Math.min(d + 10, lineLen), { units: 'meters' });
                    arrowPt.properties = { type: 'arrow', bearing: turf.bearing(arrowPt, nextPt), routeColor };
                    features.push(arrowPt);
                } catch(e) {}
            }
            if (map.getSource('active-route-meta')) {
                map.getSource('active-route-meta').setData(turf.featureCollection(features));
            }
            activeRouteAnimationId = requestAnimationFrame(frame);
        }
        activeRouteAnimationId = requestAnimationFrame(frame);
    }

    function clearActiveRoute() {
        if (activeRouteAnimationId) { cancelAnimationFrame(activeRouteAnimationId); activeRouteAnimationId = null; }
        if (map.getSource('active-route-meta')) {
            map.getSource('active-route-meta').setData({ type: 'FeatureCollection', features: [] });
        }
    }


    function openDetailPanel(props, routeColor) {
        const rideName    = props.name         || 'Unnamed Route';
        const contributor = (props.contributor && props.contributor !== 'Anonymous')
                            ? props.contributor : 'Anonymous';
        const distance    = props.distance_km
                            ? parseFloat(props.distance_km).toFixed(2) + ' km' : 'N/A';
        const time        = props.travel_time_min
                            ? parseFloat(props.travel_time_min).toFixed(0) + ' min' : 'N/A';
        const speed       = props.average_speed_kmh
                            ? parseFloat(props.average_speed_kmh).toFixed(1) + ' km/h' : 'N/A';
        const tType       = props.type || 'Unknown';
        const sourceType  = props['Source'] || '';
        const sourceLink  = props['Source Link'] || '';

        // Accent color bar + badge
        document.getElementById('route-detail-color-bar').style.background = routeColor;
        const badge = document.getElementById('route-detail-badge');
        badge.textContent = tType;
        badge.style.background = routeColor;

        // Title
        document.getElementById('route-detail-title').textContent = rideName;

        // Stats
        document.getElementById('rd-distance').textContent = distance;
        document.getElementById('rd-time').textContent     = time;
        document.getElementById('rd-speed').textContent    = speed;

        // Build source link button if available
        let sourceLinkHTML = '';
        if (sourceLink && sourceType !== 'Uploaded GPX (Drive)') {
            const isStrava  = sourceType.toLowerCase().includes('strava');
            const isKomoot  = sourceType.toLowerCase().includes('komoot');
            const icon  = isStrava ? '🟠' : isKomoot ? '🟢' : '🔗';
            const label = isStrava ? 'View on Strava' : isKomoot ? 'View on Komoot' : 'View Route';
            // Sanitise URL to prevent XSS
            const safeHref = encodeURI(sourceLink).replace(/["'<>]/g, '');
            sourceLinkHTML = `
                <a class="route-source-link" href="${safeHref}" target="_blank" rel="noopener noreferrer"
                   style="--link-color:${routeColor}">
                    <span class="route-source-icon">${icon}</span>
                    <span>${label}</span>
                    <span class="route-source-arrow">↗</span>
                </a>`;
        }

        // Extra field rows
        const fields = [
            { label: 'Contributor', value: contributor },
            { label: 'Transport',   value: tType },
        ];
        document.getElementById('route-detail-fields').innerHTML =
            fields.map(f => `
                <div class="route-field-row">
                    <span class="route-field-label">${f.label}</span>
                    <span class="route-field-value">${f.value}</span>
                </div>`).join('') + sourceLinkHTML;

        detailPanel.classList.add('open');
        detailPanel.setAttribute('aria-hidden', 'false');
    }

    function closeDetailPanel() {
        detailPanel.classList.remove('open');
        detailPanel.setAttribute('aria-hidden', 'true');
        map.setPaintProperty('route-isolation-bg', 'fill-opacity', 0);
        if (map.getLayer('selected-route')) {
            map.setFilter('selected-route', ['==', ['id'], '']);
        }
        clearActiveRoute();
        selectedFeatureId = null;
    }

    // Close button
    detailClose.addEventListener('click', closeDetailPanel);

    // Clicking blank map area closes panel
    map.on('click', (e) => {
        if (!e.defaultPrevented) closeDetailPanel();
    });

    // ── Click on route → detail panel + highlight (core + touch layer) ──
    const handleRouteClick = (e) => {
        e.preventDefault();
        if (e.features.length > 0) {
            const feature    = e.features[0];
            const props      = feature.properties;
            const tType      = props.type || 'Unknown';
            const routeColor = resolveFeatureColor(props);

            selectedFeatureId = feature.id;
            if (map.getLayer('selected-route')) {
                map.setFilter('selected-route', ['==', ['id'], selectedFeatureId]);
            }
            map.setPaintProperty('route-isolation-bg', 'fill-opacity', 0.75);
            if (map.getLayer('route-isolation-bg')) map.moveLayer('route-isolation-bg');
            if (map.getLayer('selected-route'))     map.moveLayer('selected-route');

            // Run animation engine
            animateActiveRoute(feature, tType, routeColor);

            // Re-stack annotation layers above selected-route
            if (map.getLayer('active-route-endpoints'))       map.moveLayer('active-route-endpoints');
            if (map.getLayer('active-route-endpoint-labels')) map.moveLayer('active-route-endpoint-labels');
            if (map.getLayer('active-route-arrows'))          map.moveLayer('active-route-arrows');
            if (map.getLayer('active-route-midpoint'))        map.moveLayer('active-route-midpoint');

            openDetailPanel(props, routeColor);
        }
    };

    // NOTE: click handlers are registered once at module level (below)
    //       Do NOT add map.on('click') here — it would duplicate on every style switch.
    window._handleRouteClick = handleRouteClick;
}

map.on('load', initMapLayers);

// Route click handlers — registered ONCE at module level
map.on('click', 'routes-core',  (...args) => {
    if (typeof window._handleRouteClick === 'function') window._handleRouteClick(...args);
});
map.on('click', 'routes-touch', (...args) => {
    if (typeof window._handleRouteClick === 'function') window._handleRouteClick(...args);
});

// Route hover handlers — registered ONCE at module level
map.on('mousemove',  'routes-core',  (...args) => { if (typeof window._handleRouteHoverEnter === 'function') window._handleRouteHoverEnter(...args); });
map.on('mouseleave', 'routes-core',  (...args) => { if (typeof window._handleRouteHoverLeave === 'function') window._handleRouteHoverLeave(...args); });
map.on('mousemove',  'routes-touch', (...args) => { if (typeof window._handleRouteHoverEnter === 'function') window._handleRouteHoverEnter(...args); });
map.on('mouseleave', 'routes-touch', (...args) => { if (typeof window._handleRouteHoverLeave === 'function') window._handleRouteHoverLeave(...args); });

// ─── Toggle button event listeners ──────────────
document.getElementById('viz-type').addEventListener('click', () => applyColorMode('type'));
document.getElementById('viz-distance').addEventListener('click', () => applyColorMode('distance'));

document.getElementById('toggle-transit').addEventListener('change', (e) => {
    const visibility = e.target.checked ? 'visible' : 'none';
    if (map.getLayer('transit-lines'))         map.setLayoutProperty('transit-lines',         'visibility', visibility);
    if (map.getLayer('transit-stations'))      map.setLayoutProperty('transit-stations',      'visibility', visibility);
    if (map.getLayer('transit-station-icons')) map.setLayoutProperty('transit-station-icons', 'visibility', visibility);
});

document.getElementById('toggle-dbkl').addEventListener('change', (e) => {
    const visibility = e.target.checked ? 'visible' : 'none';
    if (map.getLayer('dbkl-polygons-fill'))    map.setLayoutProperty('dbkl-polygons-fill',    'visibility', visibility);
    if (map.getLayer('dbkl-polygons-outline')) map.setLayoutProperty('dbkl-polygons-outline', 'visibility', visibility);
    if (map.getLayer('dbkl-routes-halo'))      map.setLayoutProperty('dbkl-routes-halo',      'visibility', visibility);
    if (map.getLayer('dbkl-routes-core'))      map.setLayoutProperty('dbkl-routes-core',      'visibility', visibility);
});

// ─── Basemap Switcher ──────────────────────────────
// Shows/hides pre-loaded raster tile layers. Custom data layers are NEVER removed.
document.querySelectorAll('.basemap-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        const style = btn.dataset.style;
        if (style === currentBasemap) return;
        currentBasemap = style;

        // Update active button state
        document.querySelectorAll('.basemap-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');

        // Show only the selected basemap layer, hide the rest
        Object.keys(BASEMAP_TILES).forEach(k => {
            const layerId = 'basemap-' + k;
            if (map.getLayer(layerId)) {
                map.setLayoutProperty(layerId, 'visibility', k === style ? 'visible' : 'none');
            }
        });
    });
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

    // 2. Evaluate Transport Type Constraints
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
    if (map.getLayer('routes-halo'))  map.setFilter('routes-halo',  finalFilter);
    if (map.getLayer('routes-core'))  map.setFilter('routes-core',  finalFilter);
    if (map.getLayer('routes-touch')) map.setFilter('routes-touch', finalFilter);
}

// Attach universally
distSlider.addEventListener('input', updateAllFilters);
document.getElementById('sidebar').addEventListener('change', (e) => {
    if (e.target.classList.contains('contrib-filter') || e.target.classList.contains('type-filter')) {
        updateAllFilters();
    }
});

// ─── Near Me Feature ──────────────────────────────────────────────────
(function setupNearMe() {
    const NEAR_RADIUS_KM = 3; // matches the outermost concentric ring (3 km)
    const btn = document.getElementById('fab-near-me');
    if (!btn) return;

    let userMarker   = null;
    let nearMeActive = false;

    // Add concentric ring layers (same structure as transit station rings, orange)
    let nearMeRingAnimId = null;

    function addNearMeLayers() {
        if (!map.getSource('near-me-rings')) {
            map.addSource('near-me-rings', {
                type: 'geojson',
                data: { type: 'FeatureCollection', features: [] }
            });
        }

        // Add layers if they don't exist yet (they get wiped on style switch)
        if (map.getLayer('near-me-rings-fill')) return;

        // Subtle orange fill inside each ring
        map.addLayer({
            id: 'near-me-rings-fill',
            type: 'fill',
            source: 'near-me-rings',
            layout: {},
            paint: {
                'fill-color': '#e67e22',
                'fill-opacity': 0.05
            }
        });

        // Dashed orange ring outline
        map.addLayer({
            id: 'near-me-rings-line',
            type: 'line',
            source: 'near-me-rings',
            layout: {},
            paint: {
                'line-color': '#e67e22',
                'line-width': 1.5,
                'line-dasharray': [2, 2],
                'line-opacity': 0.7
            }
        });

        // Arc labels along each ring line
        map.addLayer({
            id: 'near-me-rings-label',
            type: 'symbol',
            source: 'near-me-rings',
            filter: ['==', ['geometry-type'], 'LineString'],
            minzoom: 11,
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
                'text-color': '#c0530a',
                'text-halo-color': '#ffffff',
                'text-halo-width': 1.5
            }
        });
    }

    function animateNearMeRings(coords) {
        if (nearMeRingAnimId) cancelAnimationFrame(nearMeRingAnimId);

        const startTime = performance.now();
        const duration  = 500;

        function frame(time) {
            let progress = (time - startTime) / duration;
            if (progress > 1) progress = 1;

            const ease = 1 - Math.pow(1 - progress, 3);

            const r1 = Math.max(0.001, 0.4 * ease);  // 400 m
            const r2 = Math.max(0.001, 1.0 * ease);  // 1 km
            const r3 = Math.max(0.001, 3.0 * ease);  // 3 km

            try {
                const poly3km  = turf.circle(coords, r3, { steps: 64 });
                const poly1km  = turf.circle(coords, r2, { steps: 64 });
                const poly400m = turf.circle(coords, r1, { steps: 64 });

                const line3km  = turf.polygonToLine(poly3km);
                const line1km  = turf.polygonToLine(poly1km);
                const line400m = turf.polygonToLine(poly400m);

                line3km.properties.label  = progress > 0.3 ? '15 minutes by bike' : '';
                line1km.properties.label  = progress > 0.3 ? '5 minutes by bike'  : '';
                line400m.properties.label = progress > 0.3 ? '5 minute walk'       : '';

                map.getSource('near-me-rings').setData(turf.featureCollection([
                    poly3km, poly1km, poly400m,
                    line3km, line1km, line400m
                ]));
            } catch (err) { /* skip sub-mm interpolation errors */ }

            if (progress < 1) nearMeRingAnimId = requestAnimationFrame(frame);
            else nearMeRingAnimId = null;
        }

        nearMeRingAnimId = requestAnimationFrame(frame);
    }

    if (map.loaded()) {
        addNearMeLayers();
    } else {
        map.on('load', addNearMeLayers);
    }

    function clearNearMe() {
        nearMeActive = false;
        btn.classList.remove('active', 'locating', 'error');
        btn.querySelector('.fab-near-me-label').textContent = 'Near Me';
        btn.querySelector('.fab-near-me-icon').textContent  = '📍';

        if (userMarker) { userMarker.remove(); userMarker = null; }

        if (nearMeRingAnimId) { cancelAnimationFrame(nearMeRingAnimId); nearMeRingAnimId = null; }
        if (map.getSource('near-me-rings')) {
            map.getSource('near-me-rings').setData({ type: 'FeatureCollection', features: [] });
        }

        // Remove the proximity filter — defer to the normal slider/checkbox filters
        updateAllFilters();
    }

    function applyNearMeFilter(userCoords) {
        fetch('data/routes.geojson')
            .then(r => r.json())
            .then(geoData => {
                const userPt = turf.point(userCoords);
                const nearbyNames = [];

                geoData.features.forEach(f => {
                    const centroid = turf.centroid(f);
                    const dist = turf.distance(userPt, centroid, { units: 'kilometers' });
                    if (dist <= NEAR_RADIUS_KM) {
                        const name = f.properties.name || '';
                        if (name) nearbyNames.push(name);
                    }
                });

                if (nearbyNames.length === 0) {
                    const hideAll = ['==', '1', '2'];
                    if (map.getLayer('routes-halo')) map.setFilter('routes-halo', hideAll);
                    if (map.getLayer('routes-core')) map.setFilter('routes-core', hideAll);
                    return;
                }

                const nearFilter = ['in', ['coalesce', ['get', 'name'], ''], ['literal', nearbyNames]];
                if (map.getLayer('routes-halo')) map.setFilter('routes-halo', nearFilter);
                if (map.getLayer('routes-core')) map.setFilter('routes-core', nearFilter);
            })
            .catch(err => console.warn('Near Me filter error:', err));
    }

    btn.addEventListener('click', () => {
        if (nearMeActive) { clearNearMe(); return; }

        if (!navigator.geolocation) {
            btn.classList.add('error');
            btn.querySelector('.fab-near-me-label').textContent = 'Not supported';
            setTimeout(() => {
                btn.classList.remove('error');
                btn.querySelector('.fab-near-me-label').textContent = 'Near Me';
            }, 2500);
            return;
        }

        // Locating state
        btn.classList.add('locating');
        btn.querySelector('.fab-near-me-label').textContent = 'Locating…';
        btn.querySelector('.fab-near-me-icon').textContent  = '⏳';

        navigator.geolocation.getCurrentPosition(
            (pos) => {
                const { longitude, latitude } = pos.coords;
                const userCoords = [longitude, latitude];

                // Drop an orange user-location dot marker
                const el = document.createElement('div');
                el.style.cssText = [
                    'width:18px', 'height:18px', 'border-radius:50%',
                    'background:#e67e22', 'border:3px solid #fff',
                    'box-shadow:0 0 0 4px rgba(230,126,34,0.30)',
                    'cursor:default'
                ].join(';');

                if (userMarker) userMarker.remove();
                userMarker = new maplibregl.Marker({ element: el })
                    .setLngLat(userCoords)
                    .addTo(map);

                // Animate concentric rings: 400m / 1 km / 3 km
                animateNearMeRings(userCoords);

                // Fly to location and apply the proximity filter
                map.flyTo({ center: userCoords, zoom: 13, speed: 1.4 });
                applyNearMeFilter(userCoords);

                // Active state
                nearMeActive = true;
                btn.classList.remove('locating');
                btn.classList.add('active');
                btn.querySelector('.fab-near-me-label').textContent = 'Near Me ✓';
                btn.querySelector('.fab-near-me-icon').textContent  = '📍';
            },
            (err) => {
                console.warn('Geolocation error:', err);
                btn.classList.remove('locating');
                btn.classList.add('error');
                btn.querySelector('.fab-near-me-label').textContent =
                    err.code === 1 ? 'Access denied' : 'Location error';
                btn.querySelector('.fab-near-me-icon').textContent = '⚠️';
                setTimeout(() => {
                    btn.classList.remove('error');
                    btn.querySelector('.fab-near-me-label').textContent = 'Near Me';
                    btn.querySelector('.fab-near-me-icon').textContent  = '📍';
                }, 3000);
            },
            { enableHighAccuracy: true, timeout: 10000 }
        );
    });
}());

// ─── Persistent User Location Dot ────────────────────────────────────────────
// Uses a DOM Marker so it renders ABOVE all WebGL layers automatically.
// watchPosition keeps it updated as the device moves.
(function setupUserLocation() {
    if (!navigator.geolocation) return;

    // Blue pulsing dot
    const dotEl = document.createElement('div');
    dotEl.className = 'user-location-dot';
    const dotMarker = new maplibregl.Marker({ element: dotEl, anchor: 'center' });

    // Accuracy radius ring (sits behind the dot)
    const accEl = document.createElement('div');
    accEl.className = 'user-location-accuracy';
    const accMarker = new maplibregl.Marker({ element: accEl, anchor: 'center' });

    let lastAccuracy = null;
    let lastLat      = null;

    // Convert metres accuracy → CSS pixel diameter at current zoom + latitude
    function accuracyToPx(accuracyMetres, lat) {
        const zoom = map.getZoom();
        const mpp  = (156543.03392 * Math.cos(lat * Math.PI / 180)) / Math.pow(2, zoom);
        return Math.max((accuracyMetres / mpp) * 2, 24); // min 24 px
    }

    function updateAccuracyRing() {
        if (lastAccuracy === null || lastLat === null) return;
        const sizePx = accuracyToPx(lastAccuracy, lastLat);
        accEl.style.width  = sizePx + 'px';
        accEl.style.height = sizePx + 'px';
    }

    // Re-scale the accuracy ring whenever zoom changes
    map.on('zoom', updateAccuracyRing);

    navigator.geolocation.watchPosition(
        (pos) => {
            const { longitude, latitude, accuracy } = pos.coords;
            lastAccuracy = accuracy;
            lastLat      = latitude;

            dotMarker.setLngLat([longitude, latitude]).addTo(map);

            updateAccuracyRing();
            accMarker.setLngLat([longitude, latitude]).addTo(map);
        },
        (err) => { console.warn('User location unavailable:', err.message); },
        { enableHighAccuracy: true, timeout: 15000, maximumAge: 5000 }
    );
}());
