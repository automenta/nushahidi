import L from 'leaflet';
import 'leaflet.markercluster';
import 'leaflet.draw';
import { appStore } from '../store.js';
import { C, $, showToast, generateUUID, getGhPrefixes } from '../utils.js';
import { showConfirmModal } from '../ui/modals.js';
import { dbSvc } from './db.js';
import { confSvc } from './config.js';

let _map, _mapRepsLyr = L.layerGroup();
let _mapTileLyr;
let _drawnItems;
let _drawControl;

const handleDrawCreated = async e => {
    const layer = e.layer;
    const geojson = layer.toGeoJSON();
    const shapeId = generateUUID();
    geojson.properties = { ...geojson.properties, id: shapeId };
    layer.options.id = shapeId;

    _drawnItems.addLayer(layer);
    await dbSvc.addDrawnShape({ id: shapeId, geojson: geojson });
    appStore.set(s => ({ drawnShapes: [...s.drawnShapes, geojson] }));
    showToast("Shape drawn and saved!", 'success');
};

const handleDrawEdited = async e => {
    for (const layer of Object.values(e.layers._layers)) {
        const geojson = layer.toGeoJSON();
        const shapeId = layer.options.id;
        geojson.properties = { ...geojson.properties, id: shapeId };
        await dbSvc.addDrawnShape({ id: shapeId, geojson: geojson });
    }
    const updatedShapes = await dbSvc.getAllDrawnShapes();
    appStore.set({ drawnShapes: updatedShapes.map(s => s.geojson) });
    showToast("Shape edited and saved!", 'success');
};

const handleDrawDeleted = async e => {
    for (const layer of Object.values(e.layers._layers)) {
        const shapeId = layer.options.id;
        await dbSvc.rmDrawnShape(shapeId);
    }
    const updatedShapes = await dbSvc.getAllDrawnShapes();
    appStore.set({ drawnShapes: updatedShapes.map(s => s.geojson) });
    showToast("Shape deleted!", 'info');
};

function setupMapEventListeners() {
    _map.on('moveend zoomend', () => {
        const bounds = _map.getBounds();
        const geohashes = getGhPrefixes(bounds);
        appStore.set({ mapBnds: bounds, mapGhs: geohashes });
    });

    _map.on(L.Draw.Event.CREATED, handleDrawCreated);
    _map.on(L.Draw.Event.EDITED, handleDrawEdited);
    _map.on(L.Draw.Event.DELETED, handleDrawDeleted);
}

export const mapSvc = {
    init(id = 'map-container') {
        const tileUrl = confSvc.getTileServer();
        _map = L.map(id).setView([20, 0], 3);
        _mapTileLyr = L.tileLayer(tileUrl, { attribution: '&copy; OSM & NM', maxZoom: 19 }).addTo(_map);

        _mapRepsLyr = L.markerClusterGroup();
        _map.addLayer(_mapRepsLyr);

        _drawnItems = new L.FeatureGroup();
        _map.addLayer(_drawnItems);

        _drawControl = new L.Control.Draw({
            edit: {
                featureGroup: _drawnItems,
                poly: {
                    allowIntersection: false
                }
            },
            draw: {
                polygon: {
                    allowIntersection: false,
                    showArea: true
                },
                polyline: false,
                rectangle: true,
                circle: true,
                marker: false,
                circlemarker: false
            }
        });

        appStore.set({ map: _map });

        setupMapEventListeners();
        this.loadDrawnShapes();

        return _map;
    },

    async loadDrawnShapes() {
        const storedShapes = await dbSvc.getAllDrawnShapes();
        _drawnItems.clearLayers();
        const geojsonShapes = [];
        storedShapes.forEach(s => {
            const layer = L.GeoJSON.geometryToLayer(s.geojson);
            layer.options.id = s.id;
            _drawnItems.addLayer(layer);
            geojsonShapes.push(s.geojson);
        });
        appStore.set({ drawnShapes: geojsonShapes });
    },

    async clearAllDrawnShapes() {
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

    updTile(url) {
        if (_mapTileLyr) _mapTileLyr.setUrl(url);
    },

    updReps(reports) {
        if (!_map) return;
        _mapRepsLyr.clearLayers();
        reports.forEach(report => {
            if (report.lat && report.lon) {
                const marker = L.marker([report.lat, report.lon]);
                marker.bindPopup(`<b>${report.title || 'Report'}</b><br>${report.sum || report.ct.substring(0, 50) + '...'}`, { maxWidth: 250 });
                marker.on('click', () => {
                    appStore.set(s => ({ ...s, ui: { ...s.ui, viewingReport: report.id } }));
                });
                _mapRepsLyr.addLayer(marker);
            }
        });
    },

    ctrUser() {
        if (!_map || !navigator.geolocation) {
            return showToast("Geolocation not supported by your browser.", 'warning');
        }
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
            if (data?.length > 0) {
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
