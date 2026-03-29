// Initialize MapLibre GL Map
const map = new maplibregl.Map({
    container: 'map',
    style: 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json',
    center: [101.6869, 3.1390], // Kuala Lumpur default center
    zoom: 11,
    pitch: 45, // Add a slight pitch for more dynamic feel
    bearing: 0,
    antialias: true
});

// Add navigation controls
map.addControl(new maplibregl.NavigationControl({
    visualizePitch: true
}), 'top-right');

let hoveredRunId = null;

map.on('load', () => {
    
    // Add GeoJSON source
    map.addSource('commute-routes', {
        type: 'geojson',
        data: 'data/routes.geojson',
        generateId: true // Required for feature state hover
    });

    // Layer 1: The glowing background blur effect
    map.addLayer({
        id: 'routes-blur',
        type: 'line',
        source: 'commute-routes',
        layout: {
            'line-join': 'round',
            'line-cap': 'round'
        },
        paint: {
            'line-color': [
                'match',
                ['get', 'type'],
                'walking', '#eb5b36',
                /* default is cycling */ '#00f2fe'
            ],
            'line-width': [
                'interpolate', ['linear'], ['zoom'],
                10, 8,
                15, 20
            ],
            'line-blur': [
                'interpolate', ['linear'], ['zoom'],
                10, 4,
                15, 12
            ],
            'line-opacity': 0.6
        }
    });

    // Layer 2: The solid core line
    map.addLayer({
        id: 'routes-core',
        type: 'line',
        source: 'commute-routes',
        layout: {
            'line-join': 'round',
            'line-cap': 'round'
        },
        paint: {
            'line-color': [
                'match',
                ['get', 'type'],
                'walking', '#fff0ec',
                /* default is cycling */ '#ffffff'
            ],
            'line-width': [
                'interpolate', ['linear'], ['zoom'],
                10, 2,
                15, 6
            ],
            // Feature state for hover interaction
            'line-opacity': [
                'case',
                ['boolean', ['feature-state', 'hover'], false],
                1.0,
                0.8
            ]
        }
    });

    // Calculate Bounding Box and Stats from fetched data
    fetch('data/routes.geojson')
        .then(res => res.json())
        .then(data => {
            let totalDist = 0;
            let totalCount = data.features.length;

            if (totalCount > 0) {
                // Calculate simple bounding box to fit map
                let bounds = new maplibregl.LngLatBounds();
                
                data.features.forEach(feature => {
                    // Accumulate distance
                    if (feature.properties.distance_km) {
                        totalDist += feature.properties.distance_km;
                    }

                    // Expand bounds based on geometry coordinates
                    if (feature.geometry.type === 'MultiLineString') {
                        feature.geometry.coordinates.forEach(line => {
                            line.forEach(coord => {
                                bounds.extend(coord);
                            });
                        });
                    } else if (feature.geometry.type === 'LineString') {
                        feature.geometry.coordinates.forEach(coord => {
                            bounds.extend(coord);
                        });
                    }
                });

                // Update UI Stats
                document.getElementById('total-routes').innerText = totalCount;
                document.getElementById('total-distance').innerText = totalDist.toFixed(1) + ' km';

                // Fit map to bounds with padding
                map.fitBounds(bounds, {
                    padding: { top: 50, bottom: 50, left: 400, right: 50 },
                    maxZoom: 14,
                    duration: 2000 // smooth animation
                });
            }
        })
        .catch(err => console.error("Could not load GeoJSON:", err));

    // Interaction handlers
    map.on('mousemove', 'routes-core', (e) => {
        map.getCanvas().style.cursor = 'pointer';

        if (e.features.length > 0) {
            if (hoveredRunId !== null) {
                map.setFeatureState(
                    { source: 'commute-routes', id: hoveredRunId },
                    { hover: false }
                );
            }
            hoveredRunId = e.features[0].id;
            map.setFeatureState(
                { source: 'commute-routes', id: hoveredRunId },
                { hover: true }
            );
        }
    });

    map.on('mouseleave', 'routes-core', () => {
        map.getCanvas().style.cursor = '';
        if (hoveredRunId !== null) {
            map.setFeatureState(
                { source: 'commute-routes', id: hoveredRunId },
                { hover: false }
            );
        }
        hoveredRunId = null;
    });

    // Click handler for Popup
    map.on('click', 'routes-core', (e) => {
        if (e.features.length > 0) {
            const props = e.features[0].properties;
            const routeName = props.name || 'Unnamed Route';
            const routeType = props.type ? (props.type.charAt(0).toUpperCase() + props.type.slice(1)) : 'Unknown';
            const distance = props.distance_km ? parseFloat(props.distance_km).toFixed(2) + ' km' : 'N/A';

            // Calculate center of the clicked line for popup placing
            const coordinates = e.lngLat;

            const tooltipHTML = `
                <div class="popup-title">${routeName}</div>
                <div class="popup-detail">Type: <span>${routeType}</span></div>
                <div class="popup-detail">Distance: <span>${distance}</span></div>
            `;

            new maplibregl.Popup({ closeButton: true, closeOnClick: true })
                .setLngLat(coordinates)
                .setHTML(tooltipHTML)
                .addTo(map);
        }
    });
});
