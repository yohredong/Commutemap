'use strict';

const $ = id => document.getElementById(id);
const icon = name => `<svg class="icon small" aria-hidden="true"><use href="#i-${name}"/></svg>`;
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const mobile = window.matchMedia('(max-width: 819px)');
const emptyCollection = () => ({type:'FeatureCollection',features:[]});
const state = {routes:[],stations:[],filtered:[],selected:null,type:'all',distance:'all',sort:'name',search:'',inView:false,near:null,colour:'type',basemap:'light',tab:'routes',ready:false};
const brand = Object.freeze({navy:'#223a6a',green:'#add7b2',ice:'#c9e3e8',rust:'#c05726'});
const contrastInk = colour => [brand.green,brand.ice].includes(colour) ? brand.navy : '#ffffff';
const typeInfo = {
  'bicycle': {label:'Bicycle',color:brand.navy,icon:'bike'},
  'electric bicycle': {label:'E-bike',color:brand.rust,icon:'bolt'},
  'hyperscooter': {label:'Hyperscooter',color:brand.green,icon:'scooter'},
  'electric scooter': {label:'E-scooter',color:brand.ice,icon:'scooter'},
  'unknown': {label:'Other',color:'#595959',icon:'map'}
};
const infoFor = feature => typeInfo[feature.properties.type] || typeInfo.unknown;
const numberValue = value => value === null || value === undefined || value === '' || !Number.isFinite(Number(value)) ? null : Number(value);
const metric = (value, digits = 1) => numberValue(value) === null ? 'Not recorded' : Number(value).toFixed(digits);
const distanceColour = distance => numberValue(distance) === null ? '#595959' : distance < 3 ? brand.navy : distance < 10 ? brand.green : brand.rust;
const colourFor = feature => state.colour === 'distance' ? distanceColour(feature.properties.distance_km) : infoFor(feature).color;
let map = null;
let toastTimer;
let mapMessageTimer;
let userMarker = null;
let activeStationPopup = null;

function toast(message) {
  $('toast').textContent = message; $('toast').hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => $('toast').hidden = true, 3500);
}
function mapMessage(message, persistent = false) {
  $('map-message').textContent = message; $('map-message').hidden = false;
  clearTimeout(mapMessageTimer);
  if (!persistent) mapMessageTimer = setTimeout(() => $('map-message').hidden = true, 7000);
}
function walkCoordinates(coordinates, callback) {
  if (typeof coordinates[0] === 'number') callback(coordinates);
  else coordinates.forEach(c => walkCoordinates(c, callback));
}
function mapPadding() {
  const obscured = mobile.matches && $('route-panel').classList.contains('expanded')
    ? Math.max(0, $('route-panel').getBoundingClientRect().height - 191) : 0;
  return mobile.matches ? {top:70,right:35,bottom:obscured + 16,left:20} : {top:90,right:55,bottom:55,left:45};
}
function fitFeatures(features, animate = true) {
  if (!map || !features.length) return;
  const bounds = new maplibregl.LngLatBounds();
  features.forEach(f => walkCoordinates(f.geometry.coordinates, c => bounds.extend(c)));
  map.fitBounds(bounds,{padding:mapPadding(),maxZoom:14.5,duration:animate && !reducedMotion.matches ? 600 : 0});
}
function expandSheet(expanded) {
  $('route-panel').classList.toggle('expanded',expanded);
  $('sheet-toggle').setAttribute('aria-expanded',String(expanded));
  $('sheet-toggle').querySelector('.sheet-action').textContent = expanded ? 'Show map' : 'Expand';
}
function showTab(tab, focus = false) {
  state.tab = tab;
  const routes = tab === 'routes';
  $('browse-view').hidden = !routes || state.selected !== null;
  $('detail-view').hidden = !routes || state.selected === null;
  $('layers-view').hidden = routes;
  $('detail-peek').hidden = !routes || state.selected === null;
  $('sheet-summary').textContent = routes ? (state.selected === null ? `${state.filtered.length} community routes` : 'Journey details') : 'Map layers';
  $('routes-tab').setAttribute('aria-selected',String(routes));
  $('layers-tab').setAttribute('aria-selected',String(!routes));
  $('routes-tab').tabIndex = routes ? 0 : -1;
  $('layers-tab').tabIndex = routes ? -1 : 0;
  if (mobile.matches) expandSheet(true);
  if (focus) $(routes ? 'routes-tab' : 'layers-tab').focus();
}
function setUrlSelection(id) {
  const url = new URL(location.href);
  if (id === null) url.searchParams.delete('route'); else url.searchParams.set('route',id);
  history.replaceState(null,'',url);
}
function resetFilters() {
  state.search = ''; state.type = 'all'; state.distance = 'all'; state.inView = false;
  state.near = null; state.sort = 'name';
  $('search').value = ''; $('distance').value = 'all'; $('sort').value = 'name'; $('in-view').checked = false;
  document.querySelectorAll('[data-type]').forEach(b => b.setAttribute('aria-pressed',String(b.dataset.type === 'all')));
  $('near-filter').hidden = true;
  $('near-me').classList.remove('active');
  if (userMarker) { userMarker.remove(); userMarker = null; }
  applyFilters();
}
function routeIsInView(feature) {
  if (!map) return true;
  const view = map.getBounds(); const route = feature._bounds;
  return route[0] <= view.getEast() && route[2] >= view.getWest() && route[1] <= view.getNorth() && route[3] >= view.getSouth();
}
function distanceToRoute(point, feature) {
  const lines = feature.geometry.type === 'MultiLineString' ? feature.geometry.coordinates : [feature.geometry.coordinates];
  return Math.min(...lines.map(coordinates => turf.pointToLineDistance(turf.point(point),turf.lineString(coordinates),{units:'kilometers'})));
}
function applyFilters() {
  const search = state.search.trim().toLocaleLowerCase();
  state.filtered = state.routes.filter(feature => {
    const p = feature.properties; const distance = numberValue(p.distance_km);
    if (search && !`${p.name || ''} ${p.contributor || ''}`.toLocaleLowerCase().includes(search)) return false;
    if (state.type === 'scooters' && !['hyperscooter','electric scooter'].includes(p.type)) return false;
    if (!['all','scooters'].includes(state.type) && p.type !== state.type) return false;
    if (state.distance !== 'all' && distance === null) return false;
    if (state.distance === 'short' && distance >= 3) return false;
    if (state.distance === 'medium' && (distance < 3 || distance >= 10)) return false;
    if (state.distance === 'long' && distance < 10) return false;
    if (state.inView && !routeIsInView(feature)) return false;
    if (state.near && !state.near.ids.has(feature.id)) return false;
    return true;
  });
  state.filtered.sort((a,b) => {
    if (state.sort !== 'name') {
      const da = numberValue(a.properties.distance_km); const db = numberValue(b.properties.distance_km);
      if (da === null) return db === null ? 0 : 1;
      if (db === null) return -1;
      return state.sort === 'longest' ? db - da : da - db;
    }
    return (a.properties.name || '').localeCompare(b.properties.name || '');
  });
  $('clear-search').hidden = !state.search;
  const active = search || state.type !== 'all' || state.distance !== 'all' || state.inView || state.near;
  $('reset-filters').hidden = !active;
  $('results-count').textContent = `${state.filtered.length} ${state.filtered.length === 1 ? 'route' : 'routes'}${active ? ` of ${state.routes.length}` : ' to explore'}`;
  $('sheet-summary').textContent = state.selected !== null ? 'Journey details' : `${state.filtered.length} community routes`;
  $('empty-state').hidden = state.filtered.length !== 0 || !state.ready;
  $('route-list').innerHTML = state.filtered.map(f => {
    const p = f.properties; const info = infoFor(f); const d = numberValue(p.distance_km);
    const time = numberValue(p.travel_time_min);
    return `<li><button class="route-button" data-route="${f.id}" style="--route-colour:${info.color};--route-ink:${contrastInk(info.color)}" aria-label="${escapeHtml(p.name || 'Unnamed route')}, ${escapeHtml(info.label)}, ${d === null ? 'distance not recorded' : d.toFixed(1)+' kilometres'}"><span class="route-symbol">${icon(info.icon)}</span><span class="route-copy"><span class="route-name">${escapeHtml(p.name || 'Unnamed route')}</span><span class="route-meta"><span>${escapeHtml(info.label)}</span>${time === null ? '' : `<span>${Math.round(time)} min recorded</span>`}</span></span><span class="route-distance">${d === null ? '—' : d.toFixed(1)}<span>${d === null ? '' : 'km'}</span></span>${icon('chevron')}</button></li>`;
  }).join('');
  if (state.ready && map) {
    const filter = ['in',['id'],['literal',state.filtered.map(f => f.id)]];
    ['routes-casing','routes-core','routes-hit'].forEach(id => map.setFilter(id,filter));
    clearHover();
  }
}
function renderColourLegend() {
  const items = state.colour === 'type'
    ? Object.values(typeInfo).map(info => [info.label,info.color])
    : [['Under 3 km',brand.navy],['3–10 km',brand.green],['10 km and above',brand.rust]];
  $('colour-legend').innerHTML = items.map(([label,colour]) => `<span><i style="--legend-colour:${colour}"></i>${escapeHtml(label)}</span>`).join('');
}
function colourExpression() {
  if (state.colour === 'distance') return ['case',['!', ['has','distance_km']], '#595959', ['<',['get','distance_km'],3],brand.navy,['<',['get','distance_km'],10],brand.green,brand.rust];
  return ['match',['get','type'],...Object.entries(typeInfo).flatMap(([type,info]) => [type,info.color]),'#595959'];
}
function casingExpression() {
  return ['case',['in',colourExpression(),['literal',[brand.green,brand.ice]]],brand.navy,'#ffffff'];
}
function applyColour() {
  renderColourLegend();
  if (!state.ready || !map) return;
  ['routes-core','selected-route','hover-route'].forEach(id => map.setPaintProperty(id,'line-color',colourExpression()));
  ['routes-casing','selection-casing','hover-casing'].forEach(id => map.setPaintProperty(id,'line-color',casingExpression()));
  if (state.selected !== null) drawEndpoints(state.routes[state.selected]);
}
function endpoints(feature) {
  const lines = feature.geometry.type === 'MultiLineString' ? feature.geometry.coordinates : [feature.geometry.coordinates];
  return [lines[0][0], lines[lines.length-1][lines[lines.length-1].length-1]];
}
function drawEndpoints(feature) {
  const colour = colourFor(feature);
  map.getSource('endpoints').setData({type:'FeatureCollection',features:endpoints(feature).map((coordinates,i) => ({type:'Feature',properties:{label:i ? 'B' : 'A',colour,labelColour:contrastInk(colour),outline:[brand.green,brand.ice].includes(colour) ? brand.navy : '#ffffff'},geometry:{type:'Point',coordinates}}))});
}
function renderStations(feature) {
  if (!state.stations.length) { $('connections').hidden = true; return; }
  $('connections').hidden = false;
  $('station-list').innerHTML = endpoints(feature).map((point,i) => {
    let nearest = null; let distance = Infinity;
    state.stations.forEach(station => {
      const d = turf.distance(turf.point(point),station,{units:'kilometers'});
      if (d < distance) { distance = d; nearest = station; }
    });
    if (!nearest || distance > 5) return `<div class="station-row"><span class="endpoint-tag">${i ? 'B' : 'A'}</span><div><strong>No station within 5 km</strong><small>Near the ${i ? 'end' : 'start'}</small></div></div>`;
    return `<div class="station-row"><span class="endpoint-tag">${i ? 'B' : 'A'}</span><div><strong>${escapeHtml(nearest.properties.name || 'Rail station')}</strong><small>Near the ${i ? 'end' : 'start'}</small></div><span>${distance < 1 ? Math.round(distance * 1000)+' m' : distance.toFixed(1)+' km'}</span></div>`;
  }).join('');
}
function selectRoute(id, focus = true) {
  const feature = state.routes.find(f => f.id === id);
  if (!feature) return;
  state.selected = id;
  const p = feature.properties; const info = infoFor(feature);
  $('detail-type').style.setProperty('--route-colour',info.color);
  $('detail-type').style.setProperty('--route-ink',contrastInk(info.color));
  $('detail-type').innerHTML = `${icon(info.icon)}<span>${escapeHtml(info.label)}</span>`;
  $('detail-title').textContent = p.name || 'Unnamed route';
  $('peek-title').textContent = p.name || 'Unnamed route';
  $('peek-stats').textContent = `${info.label}${numberValue(p.distance_km) === null ? '' : ', '+metric(p.distance_km)+' km'}${numberValue(p.travel_time_min) === null ? '' : ', '+metric(p.travel_time_min,0)+' min recorded'}`;
  $('detail-contributor').textContent = `Shared by ${p.contributor || 'an anonymous rider'}`;
  $('detail-distance').innerHTML = numberValue(p.distance_km) === null ? '<span>Not recorded</span>' : `${metric(p.distance_km)} <span>km</span>`;
  $('detail-time').innerHTML = numberValue(p.travel_time_min) === null ? '<span>Not recorded</span>' : `${metric(p.travel_time_min,0)} <span>min</span>`;
  $('detail-speed').textContent = numberValue(p.average_speed_kmh) === null ? 'Not recorded' : `${metric(p.average_speed_kmh)} km/h`;
  const source = $('source-link'); source.hidden = true; source.removeAttribute('href');
  try {
    const url = new URL(p['Source Link']);
    if (['https:','http:'].includes(url.protocol) && p.Source !== 'Uploaded GPX (Drive)') {
      source.href = url.href;
      source.querySelector('span').textContent = url.hostname.endsWith('strava.com') ? 'View on Strava' : url.hostname.endsWith('komoot.com') ? 'View on Komoot' : 'View original route';
      source.hidden = false;
    }
  } catch (_) { /* Missing source links remain absent. */ }
  renderStations(feature);
  showTab('routes');
  $('sheet-summary').textContent = 'Journey details';
  $('detail-view').querySelector('.detail-scroll').scrollTop = 0;
  if (state.ready && map) {
    clearHover();
    map.getSource('selection').setData({type:'FeatureCollection',features:[feature]});
    map.setPaintProperty('routes-core','line-opacity',0.16);
    map.setPaintProperty('routes-casing','line-opacity',0.18);
    drawEndpoints(feature); fitFeatures([feature]);
  }
  setUrlSelection(id);
  if (focus) $('detail-title').focus({preventScroll:true});
}
function closeDetails(focus = true) {
  const previous = state.selected;
  state.selected = null;
  if (state.ready && map) {
    map.getSource('selection').setData(emptyCollection());
    map.getSource('endpoints').setData(emptyCollection());
    map.setPaintProperty('routes-core','line-opacity',1);
    map.setPaintProperty('routes-casing','line-opacity',0.85);
  }
  setUrlSelection(null); showTab('routes');
  $('sheet-summary').textContent = `${state.filtered.length} community routes`;
  if (focus) {
    const button = $('route-list').querySelector(`[data-route="${previous}"]`);
    if (button) button.focus({preventScroll:true}); else $('search').focus();
  }
}
function clearHover() {
  if (state.ready && map) map.getSource('hover').setData(emptyCollection());
}

async function fetchData(path) {
  const response = await fetch(path);
  if (!response.ok) throw new Error(`Could not load ${path} (${response.status})`);
  return response.json();
}

function initialiseLayers(routes, transit, dbkl) {
  const sources = {routes:{...routes,features:state.routes},transit,dbkl,selection:emptyCollection(),hover:emptyCollection(),endpoints:emptyCollection(),catchment:emptyCollection()};
  Object.entries(sources).forEach(([id,data]) => map.addSource(id,{type:'geojson',data}));
  map.addLayer({id:'transit-lines',type:'line',source:'transit',filter:['==',['geometry-type'],'LineString'],paint:{'line-color':'#a0a0a0','line-opacity':0.42,'line-width':['interpolate',['linear'],['zoom'],10,1,15,2.5]}});
  map.addLayer({id:'dbkl-lines',type:'line',source:'dbkl',filter:['all',['==',['geometry-type'],'LineString'],['==',['get','route_type'],'Existing Route']],paint:{'line-color':brand.navy,'line-width':['interpolate',['linear'],['zoom'],10,2,15,4],'line-dasharray':[3,2],'line-opacity':0.75}});
  map.addLayer({id:'dbkl-areas',type:'fill',source:'dbkl',filter:['all',['==',['geometry-type'],'Polygon'],['==',['get','route_type'],'Existing Route']],paint:{'fill-color':brand.navy,'fill-opacity':0.08}});
  map.addLayer({id:'routes-casing',type:'line',source:'routes',layout:{'line-cap':'round','line-join':'round'},paint:{'line-color':casingExpression(),'line-width':['interpolate',['linear'],['zoom'],10,4,15,7],'line-opacity':0.85}});
  map.addLayer({id:'routes-core',type:'line',source:'routes',layout:{'line-cap':'round','line-join':'round'},paint:{'line-color':colourExpression(),'line-width':['interpolate',['linear'],['zoom'],10,2,15,4.5],'line-opacity':1}});
  map.addLayer({id:'routes-hit',type:'line',source:'routes',paint:{'line-width':18,'line-opacity':0}});
  map.addLayer({id:'catchment-fill',type:'fill',source:'catchment',paint:{'fill-color':brand.navy,'fill-opacity':0.035}});
  map.addLayer({id:'catchment-line',type:'line',source:'catchment',paint:{'line-color':brand.navy,'line-width':1,'line-dasharray':[4,3],'line-opacity':0.65}});
  map.addLayer({id:'stations',type:'circle',source:'transit',filter:['==',['geometry-type'],'Point'],paint:{'circle-color':'#fff','circle-stroke-color':'#595959','circle-stroke-width':1.5,'circle-radius':['interpolate',['linear'],['zoom'],10,2,12,3.5,15,5]}});
  map.addLayer({id:'stations-hit',type:'circle',source:'transit',filter:['==',['geometry-type'],'Point'],minzoom:12,paint:{'circle-radius':10,'circle-opacity':0}});
  map.addLayer({id:'hover-casing',type:'line',source:'hover',layout:{'line-cap':'round','line-join':'round'},paint:{'line-color':casingExpression(),'line-width':7}});
  map.addLayer({id:'hover-route',type:'line',source:'hover',layout:{'line-cap':'round','line-join':'round'},paint:{'line-color':colourExpression(),'line-width':5,'line-opacity':1}});
  map.addLayer({id:'selection-casing',type:'line',source:'selection',layout:{'line-cap':'round','line-join':'round'},paint:{'line-color':casingExpression(),'line-width':8}});
  map.addLayer({id:'selected-route',type:'line',source:'selection',layout:{'line-cap':'round','line-join':'round'},paint:{'line-color':colourExpression(),'line-width':5}});
  map.addLayer({id:'endpoint-circles',type:'circle',source:'endpoints',paint:{'circle-radius':11,'circle-color':['get','colour'],'circle-stroke-color':['get','outline'],'circle-stroke-width':3}});
  map.addLayer({id:'endpoint-labels',type:'symbol',source:'endpoints',layout:{'text-field':['get','label'],'text-size':11,'text-font':['Noto Sans Bold'],'text-allow-overlap':true},paint:{'text-color':['get','labelColour']}});
}

async function start() {
  const optionalData = Promise.allSettled([fetchData('data/transit.geojson'),fetchData('data/dbkl_routes.geojson')]);
  let mapLoaded;
  try {
    map = new maplibregl.Map({container:'map',center:[101.666,3.126],zoom:11.5,attributionControl:{compact:true},style:{version:8,glyphs:'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf',sources:{
      light:{type:'raster',tiles:['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],tileSize:256,maxzoom:19,attribution:'© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors'},
      satellite:{type:'raster',tiles:['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],tileSize:256,attribution:'Tiles © Esri and contributors'},
      terrain:{type:'raster',tiles:['https://services.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}'],tileSize:256,attribution:'Tiles © Esri and contributors'}},layers:['light','satellite','terrain'].map(key => ({id:`basemap-${key}`,type:'raster',source:key,layout:{visibility:key === 'light' ? 'visible' : 'none'},paint:key === 'light' ? {'raster-saturation':-0.85,'raster-contrast':-0.2,'raster-brightness-min':0.15} : {}}))}});
    mapLoaded = new Promise(resolve => map.once('load',resolve));
    map.addControl(new maplibregl.NavigationControl({showCompass:false}),'top-right');
    map.addControl(new maplibregl.ScaleControl({maxWidth:90}),'bottom-right');
    map.on('error',event => { console.error('Map rendering error:',event.error?.message || event.error); mapMessage('Some map tiles could not load. Check your connection; you can still browse routes.'); });
    map.on('moveend',() => { if (state.ready && state.inView) applyFilters(); });
  } catch (error) {
    console.error(error); mapMessage('This browser could not display the map. You can still search and read the routes.',true); mapLoaded = Promise.resolve();
  }
  try {
    const data = await fetchData('data/routes.geojson');
    state.routes = data.features.map((f,id) => {
      const all = []; walkCoordinates(f.geometry.coordinates,c => all.push(c));
      const lons = all.map(c => c[0]); const lats = all.map(c => c[1]);
      // Keep the original LineString / MultiLineString geometry intact.
      return {...f,id,_bounds:[Math.min(...lons),Math.min(...lats),Math.max(...lons),Math.max(...lats)]};
    });
    const total = state.routes.reduce((sum,f) => sum + (numberValue(f.properties.distance_km) || 0),0);
    const contributors = new Set(state.routes.map(f => f.properties.contributor || 'Anonymous')).size;
    $('network-summary').textContent = `${state.routes.length} routes from ${contributors} contributors. ${total.toLocaleString('en',{maximumFractionDigits:0})} km shared.`;
    // The list works immediately; optional infrastructure and WebGL load independently.
    applyFilters();
    const optional = await optionalData;
    const transit = optional[0].status === 'fulfilled' ? optional[0].value : emptyCollection();
    const dbkl = optional[1].status === 'fulfilled' ? optional[1].value : emptyCollection();
    state.stations = transit.features.filter(f => f.geometry.type === 'Point' && f.properties.name && !/^Pintu\b/i.test(f.properties.name));
    if (optional.some(result => result.status === 'rejected')) mapMessage('Some rail or DBKL data could not load. Reload to try again.',true);
    await mapLoaded;
    if (map && map.getLayer('basemap-light')) {
      initialiseLayers(data,transit,dbkl);
      ['transit-lines','stations','stations-hit'].forEach(id => map.setLayoutProperty(id,'visibility',$('transit-toggle').checked ? 'visible' : 'none'));
      ['dbkl-lines','dbkl-areas'].forEach(id => map.setLayoutProperty(id,'visibility',$('dbkl-toggle').checked ? 'visible' : 'none'));
      ['light','satellite','terrain'].forEach(key => map.setLayoutProperty(`basemap-${key}`,'visibility',key === state.basemap ? 'visible' : 'none'));
    }
    state.ready = true;
    applyFilters(); applyColour();
    wireMapInteractions();
    const requested = new URL(location.href).searchParams.get('route');
    if (requested !== null && /^\d+$/.test(requested) && state.routes.some(f => f.id === Number(requested))) selectRoute(Number(requested),false);
  } catch (error) {
    console.error(error); $('results-count').textContent = 'Routes unavailable'; $('load-error').hidden = false;
    if (mobile.matches) expandSheet(true);
  }
}

function wireMapInteractions() {
  if (!map || !map.getLayer('routes-hit')) return;
  map.on('click','routes-hit',event => {
    if (event.features.length) { event.preventDefault(); selectRoute(event.features[0].id); }
  });
  map.on('mousemove','routes-hit',event => {
    map.getCanvas().style.cursor = 'pointer';
    const f = state.routes.find(route => route.id === event.features[0]?.id);
    if (f && state.selected === null) map.getSource('hover').setData({type:'FeatureCollection',features:[f]});
  });
  map.on('mouseleave','routes-hit',() => { map.getCanvas().style.cursor = ''; clearHover(); });
  map.on('click','stations-hit',event => {
    if (event.defaultPrevented || !event.features.length) return;
    const f = event.features[0];
    if (activeStationPopup) activeStationPopup.remove();
    const inner = document.createElement('div');
    const name = document.createElement('strong'); name.className = 'station-popup-name'; name.textContent = f.properties.name || 'Rail station';
    const note = document.createElement('p'); note.className = 'station-popup-note'; note.textContent = 'Rings show 1 km and 3 km radius, not street travel distance.';
    inner.append(name,note);
    map.getSource('catchment').setData({type:'FeatureCollection',features:[1,3].map(radius => turf.circle(f.geometry.coordinates,radius,{steps:64,units:'kilometers'}))});
    activeStationPopup = new maplibregl.Popup({closeOnClick:true,maxWidth:'240px'}).setLngLat(f.geometry.coordinates).setDOMContent(inner).addTo(map);
    activeStationPopup.on('close',() => map.getSource('catchment').setData(emptyCollection()));
  });
  map.on('mouseenter','stations-hit',() => map.getCanvas().style.cursor = 'pointer');
  map.on('mouseleave','stations-hit',() => map.getCanvas().style.cursor = '');
}

// Route discovery is available independently of map pointer interactions.
$('search').addEventListener('input',event => {
  state.search = event.target.value;
  if (mobile.matches) expandSheet(true);
  applyFilters();
});
$('search').addEventListener('focus',() => { if (mobile.matches) expandSheet(true); });
$('clear-search').addEventListener('click',() => { state.search = ''; $('search').value = ''; applyFilters(); $('search').focus(); });
$('distance').addEventListener('change',event => { state.distance = event.target.value; applyFilters(); });
$('sort').addEventListener('change',event => { state.sort = event.target.value; applyFilters(); });
$('in-view').addEventListener('change',event => { state.inView = event.target.checked; applyFilters(); });
document.querySelectorAll('[data-type]').forEach(button => button.addEventListener('click',() => {
  state.type = button.dataset.type;
  document.querySelectorAll('[data-type]').forEach(b => b.setAttribute('aria-pressed',String(b === button)));
  applyFilters();
}));
['reset-filters','empty-reset'].forEach(id => $(id).addEventListener('click',resetFilters));
$('clear-near').addEventListener('click',() => {
  state.near = null; $('near-filter').hidden = true;
  if (userMarker) { userMarker.remove(); userMarker = null; }
  applyFilters();
});
$('reload').addEventListener('click',() => location.reload());
$('route-list').addEventListener('click',event => {
  const button = event.target.closest('[data-route]');
  if (button) selectRoute(Number(button.dataset.route));
});
$('route-list').addEventListener('mouseover',event => {
  const button = event.target.closest('[data-route]');
  if (button && state.ready && map) map.getSource('hover').setData({type:'FeatureCollection',features:[state.routes[Number(button.dataset.route)]]});
});
$('route-list').addEventListener('mouseleave',clearHover);
$('routes-tab').addEventListener('click',() => showTab('routes'));
$('layers-tab').addEventListener('click',() => showTab('layers'));
document.querySelector('.panel-nav').addEventListener('keydown',event => {
  if (['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) {
    event.preventDefault(); showTab(event.key === 'Home' ? 'routes' : event.key === 'End' ? 'layers' : state.tab === 'routes' ? 'layers' : 'routes',true);
  }
});
$('map-layers').addEventListener('click',() => showTab('layers',true));
$('sheet-toggle').addEventListener('click',() => {
  expandSheet(!$('route-panel').classList.contains('expanded'));
  if (state.selected !== null) fitFeatures([state.routes[state.selected]],false);
});
$('back-results').addEventListener('click',() => closeDetails());
$('fit-route').addEventListener('click',() => { if (state.selected !== null) { if (mobile.matches) expandSheet(false); fitFeatures([state.routes[state.selected]]); } });
document.addEventListener('keydown',event => {
  if (event.key === 'Escape') { if (state.selected !== null) closeDetails(); else if (mobile.matches) expandSheet(false); }
});
$('copy-link').addEventListener('click',async () => {
  try { await navigator.clipboard.writeText(location.href); toast('Route link copied.'); }
  catch (_) { toast('Copy the route link from your browser’s address bar.'); }
});
$('city-view').addEventListener('click',() => {
  if (state.selected !== null) closeDetails(false);
  if (mobile.matches) expandSheet(false);
  if (map) map.flyTo({center:[101.666,3.126],zoom:11.5,padding:0,duration:reducedMotion.matches ? 0 : 600});
});
$('all-routes-view').addEventListener('click',() => { if (mobile.matches) expandSheet(false); fitFeatures(state.routes); });
document.querySelectorAll('[data-basemap]').forEach(button => button.addEventListener('click',() => {
  state.basemap = button.dataset.basemap;
  document.querySelectorAll('[data-basemap]').forEach(b => b.setAttribute('aria-pressed',String(b === button)));
  if (map && map.getLayer('basemap-light')) ['light','satellite','terrain'].forEach(key => map.setLayoutProperty(`basemap-${key}`,'visibility',key === state.basemap ? 'visible' : 'none'));
}));
document.querySelectorAll('[data-colour]').forEach(button => button.addEventListener('click',() => {
  state.colour = button.dataset.colour;
  document.querySelectorAll('[data-colour]').forEach(b => b.setAttribute('aria-pressed',String(b === button)));
  applyColour();
}));
$('transit-toggle').addEventListener('change',event => {
  if (!state.ready || !map) return;
  ['transit-lines','stations','stations-hit'].forEach(id => map.setLayoutProperty(id,'visibility',event.target.checked ? 'visible' : 'none'));
  if (!event.target.checked && activeStationPopup) activeStationPopup.remove();
});
$('dbkl-toggle').addEventListener('change',event => {
  if (state.ready && map) ['dbkl-lines','dbkl-areas'].forEach(id => map.setLayoutProperty(id,'visibility',event.target.checked ? 'visible' : 'none'));
  $('dbkl-key').hidden = !event.target.checked; $('dbkl-key-label').hidden = !event.target.checked;
});
$('near-me').addEventListener('click',() => {
  if (!state.ready) { mapMessage('Routes are still loading. Try again in a moment.'); return; }
  if (!navigator.geolocation) { mapMessage('Location is not available in this browser. Search for your area instead.'); return; }
  const button = $('near-me'); button.disabled = true; button.querySelector('span').textContent = 'Locating…';
  navigator.geolocation.getCurrentPosition(position => {
    button.disabled = false; button.querySelector('span').textContent = 'Near me';
    const point = [position.coords.longitude,position.coords.latitude];
    state.near = {point,ids:new Set(state.routes.filter(f => distanceToRoute(point,f) <= 3).map(f => f.id))};
    $('near-filter').hidden = false; applyFilters(); showTab('routes');
    if (map) {
      if (userMarker) userMarker.remove();
      userMarker = new maplibregl.Marker({color:brand.navy}).setLngLat(point).addTo(map);
      map.flyTo({center:point,zoom:13,duration:reducedMotion.matches ? 0 : 600});
    }
    mapMessage(`${state.filtered.length} routes match your filters within 3 km of your location.`);
  },error => {
    button.disabled = false; button.querySelector('span').textContent = 'Near me';
    mapMessage(error.code === 1 ? 'Location access is off. Search for your area, or enable location for this page.' : 'Your location could not be found. Search for your area or try Near me again.');
  },{enableHighAccuracy:false,timeout:10000,maximumAge:60000});
});
window.addEventListener('resize',() => {
  if (map) map.resize();
  if (state.selected !== null) fitFeatures([state.routes[state.selected]],false);
});
mobile.addEventListener('change',() => { if (!mobile.matches) expandSheet(false); if (map) map.resize(); });
renderColourLegend(); start();
