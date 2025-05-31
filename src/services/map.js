import L from 'leaflet';
import 'leaflet.markercluster';
import 'leaflet-draw';
import { appStore } from '../store.js';
import { dbSvc } from './db.js';
import { confSvc } from './config.js';
import { generateUUID, getGhPrefixes, showToast } from '../utils.js';
import { withToast } from '../decorators.js';

let _map;
let _mapTileLyr;
let _mapRepsLyr;
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
        await processLayer(data.layer);
    } else if (action === 'edit') {
        for (const layer of data.layers.getLayers()) {
            await processLayer(layer);
        }
    } else if (action === 'delete') {
        for (const layer of data.layers.getLayers()) {
            await dbSvc.rmDrawnShape(layer.options.id);
        }
    }
    appStore.set({ drawnShapes: (await dbSvc.getAllDrawnShapes()).map(s => s.geojson) });
}, null, "Error updating drawn shapes");

function handleDrawCreated(e) {
    const { layer } = e;
    _drawnItems.addLayer(layer);
    updateDrawnShapesInStoreAndDb('add', { layer });
}

function handleDrawEdited(e) {
    updateDrawnShapesInStoreAndDb('edit', { layers: e.layers });
}

function handleDrawDeleted(e) {
    updateDrawnShapesInStoreAndDb('delete', { layers: e.layers });
}

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
        _mapTileLyr = L.tileLayer(confSvc.getTileServer(), { attribution: '&copy; OSM & NM', maxZoom: 19 }).addTo(_map);

        _mapRepsLyr = L.markerClusterGroup().addTo(_map);
        _drawnItems = new L.FeatureGroup().addTo(_map);

        _drawControl = new L.Control.Draw({
            edit: { featureGroup: _drawnItems, poly: { allowIntersection: false } },
            draw: {
                polygon: { allowIntersection: false, showArea: true },
                marker: false,
                circlemarker: false,
                rectangle: false,
                circle: false
            }
        });

        _map.addControl(_drawControl);
        setupMapEventListeners();
        await this.loadDrawnShapes();
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

    clearAllDrawnShapes: withToast(async () => {
        _drawnItems.clearLayers();
        await dbSvc.clearDrawnShapes();
        appStore.set({ drawnShapes: [] });
    }, "All drawn shapes cleared.", "Error clearing drawn shapes"),

    getDrawControl: () => _drawControl,
    getDrawnItems: () => _drawnItems,
    updTile(url) { _mapTileLyr?.setUrl(url); },

    updReps(reports) {
        if (!_map) return;
        _mapRepsLyr.clearLayers();
        reports.forEach(report => {
            if (report.lat && report.lon) {
                const marker = L.marker([report.lat, report.lon]);
                marker.bindPopup(`<b>${report.title || 'Report'}</b><br>${report.sum || report.ct.substring(0, 100)}`);
                marker.on('click', () => appStore.set(s => ({ ...s, ui: { ...s.ui, viewingReport: report.id } })));
                _mapRepsLyr.addLayer(marker);
            }
        });
    },

    enPickLoc: callback => {
        if (!_map) return;
        const mapContainer = _map.getContainer();
        mapContainer.style.cursor = 'crosshair';
        showToast("Click on the map to pick a location.", 'info');
        _map.once('click', e => {
            mapContainer.style.cursor = '';
            callback(e.latlng);
        });
    },

    get: () => _map,
};
