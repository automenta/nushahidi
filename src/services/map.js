import L from 'leaflet';
import 'ali.leaflet.markercluster';
import 'leaflet-draw';
import {appStore} from '../store.js';
import {$, generateUUID, getGhPrefixes, showToast} from '../utils.js';
import {showConfirmModal} from '../ui/modals.js';
import {dbSvc} from './db.js';
import {confSvc} from './config.js';
import {withToast} from '../decorators.js';

let _map, _mapRepsLyr = L.layerGroup();
let _mapTileLyr;
let _drawnItems;
let _drawControl;

const updateDrawnShapesInStoreAndDb = withToast(async (action, data) => {
    const processLayer = async layer => {
        const geojson = layer.toGeoJSON();
        const shapeId = layer.options.id || generateUUID();
        geojson.properties = { ...geojson.properties, id: shapeId };
        layer.options.id = shapeId;
        await dbSvc.addDrawnShape({ id: shapeId, geojson });
    };

    if (action === 'add') {
        _drawnItems.addLayer(data);
        await processLayer(data);
    } else if (action === 'edit') {
        for (const layer of Object.values(data._layers)) await processLayer(layer);
    } else if (action === 'delete') {
        for (const layer of Object.values(data._layers)) await dbSvc.rmDrawnShape(layer.options.id);
    }

    appStore.set({ drawnShapes: (await dbSvc.getAllDrawnShapes()).map(s => s.geojson) });
}, null, "Error updating drawn shapes");

const handleDrawCreated = e => updateDrawnShapesInStoreAndDb('add', e.layer);
const handleDrawEdited = e => updateDrawnShapesInStoreAndDb('edit', e.layers);
const handleDrawDeleted = e => updateDrawnShapesInStoreAndDb('delete', e.layers);

function setupMapEventListeners() {
    _map.on('moveend zoomend', () => {
        const bounds = _map.getBounds();
        appStore.set({ mapBnds: bounds, mapGhs: getGhPrefixes(bounds) });
    });
    _map.on(L.Draw.Event.CREATED, handleDrawCreated);
    _map.on(L.Draw.Event.EDITED, handleDrawEdited);
    _map.on(L.Draw.Event.DELETED, handleDrawDeleted);
}

export const mapSvc = {
    async init(id = 'map-container') {
        _map = L.map(id).setView([20, 0], 3);
        _mapTileLyr = L.tileLayer(confSvc.getTileServer(), {attribution: '&copy; OSM & NM', maxZoom: 19}).addTo(_map);

        _mapRepsLyr = L.markerClusterGroup().addTo(_map);
        _drawnItems = new L.FeatureGroup().addTo(_map);

        _drawControl = new L.Control.Draw({
            edit: {featureGroup: _drawnItems, poly: {allowIntersection: false}},
            draw: {
                polygon: {allowIntersection: false, showArea: true},
                polyline: false, rectangle: true, circle: true, marker: false, circlemarker: false
            }
        });

        appStore.set({map: _map});
        setupMapEventListeners();
        await this.loadDrawnShapes();
        return _map;
    },

    async loadDrawnShapes() {
        _drawnItems.clearLayers();
        const geojsonShapes = [];
        const rawDrawnShapes = await dbSvc.getAllDrawnShapes();
        const drawnShapes = Array.isArray(rawDrawnShapes) ? rawDrawnShapes : [];
        drawnShapes.forEach(s => {
            const layer = L.GeoJSON.geometryToLayer(s.geojson);
            layer.options.id = s.id;
            _drawnItems.addLayer(layer);
            geojsonShapes.push(s.geojson);
        });
        appStore.set({ drawnShapes: geojsonShapes });
    },

    clearAllDrawnShapes() {
        showConfirmModal(
            "Clear All Drawn Shapes",
            "Are you sure you want to clear ALL drawn shapes from the map and database? This action cannot be undone.",
            async () => {
                _drawnItems.clearLayers();
                await dbSvc.clearDrawnShapes();
                appStore.set({ drawnShapes: [] });
                showToast("All drawn shapes cleared.", 'info');
            },
            () => showToast("Clearing shapes cancelled.", 'info')
        );
    },

    getDrawControl: () => _drawControl,
    getDrawnItems: () => _drawnItems,
    updTile(url) { _mapTileLyr?.setUrl(url); },

    updReps(reports) {
        if (!_map) return;
        _mapRepsLyr.clearLayers();
        reports.forEach(report => {
            if (report.lat && report.lon) {
                const marker = L.marker([report.lat, report.lon]);
                marker.bindPopup(`<b>${report.title || 'Report'}</b><br>${report.sum || report.ct.substring(0, 50) + '...'}`, { maxWidth: 250 });
                marker.on('click', () => appStore.set(s => ({ ...s, ui: { ...s.ui, viewingReport: report.id } })));
                _mapRepsLyr.addLayer(marker);
            }
        });
    },

    ctrUser() {
        if (!_map || !navigator.geolocation) return showToast("Geolocation not supported by your browser.", 'warning');
        navigator.geolocation.getCurrentPosition(
            position => {
                const latlng = [position.coords.latitude, position.coords.longitude];
                _map.setView(latlng, 13);
                L.marker(latlng).addTo(_map).bindPopup("You").openPopup();
            },
            error => showToast(`GPS Error: ${error.message}`, 'error')
        );
    },

    searchLoc: async query => {
        if (!_map) return;
        try {
            const response = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=1`);
            const data = await response.json();
            if (data?.[0]) {
                const { lat, lon, display_name } = data[0];
                _map.setView([parseFloat(lat), parseFloat(lon)], 12);
                L.popup().setLatLng([parseFloat(lat), parseFloat(lon)]).setContent(display_name).openOn(_map);
                showToast(`Location found: ${display_name}`, 'success');
            } else {
                showToast("Location not found.", 'info');
            }
        } catch (e) {
            showToast(`Location search error: ${e.message}`, 'error');
        }
    },

    enPickLoc: callback => {
        if (!_map) return;
        const mapContainer = $('#map-container');
        mapContainer.style.cursor = 'crosshair';
        showToast("Click on the map to pick a location.", 'info');
        _map.once('click', e => {
            mapContainer.style.cursor = '';
            callback(e.latlng);
        });
    },

    disPickLoc: () => {
        if ($('#map-container')) $('#map-container').style.cursor = '';
        if (_map) _map.off('click');
    },

    get: () => _map,
};
