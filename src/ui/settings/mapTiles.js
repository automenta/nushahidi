import { appStore } from '../../store.js';
import { confSvc, mapSvc } from '../../services.js';
import { C, $, showToast, isValidUrl } from '../../utils.js';
import { withToast } from '../../decorators.js';
import { renderForm } from '../forms.js';

/**
 * Renders the map tiles settings section form.
 * @param {HTMLElement} modalContent The parent modal content element.
 * @returns {HTMLElement} The rendered form element.
 */
export const renderMapTilesSection = (modalContent) => {
    const appState = appStore.get();

    const mapTilesFormFields = [
        {
            label: 'Tile Server Preset:',
            type: 'select',
            id: 'tile-preset-sel',
            name: 'tilePreset',
            value: appState.settings.tilePreset,
            options: C.TILE_SERVERS_PREDEFINED.map(p => ({ value: p.name, label: p.name }))
        },
        { label: 'Custom Tile URL Template:', type: 'url', id: 'tile-url-in', name: 'tileUrl', value: appState.settings.tileUrl },
        { label: 'Save Tiles', type: 'button', id: 'save-tile-btn', buttonType: 'button' }
    ];

    const form = renderForm(mapTilesFormFields, {}, { id: 'map-tiles-form' });
    modalContent.appendChild(form); // Append to modalContent directly

    setupMapTilesListeners(form);
    return form;
};

/**
 * Sets up event listeners for the map tiles settings section.
 * @param {HTMLElement} formRoot The root element of the map tiles form.
 */
const setupMapTilesListeners = (formRoot) => {
    const tilePresetSel = $('#tile-preset-sel', formRoot);
    const tileUrlIn = $('#tile-url-in', formRoot);
    const appState = appStore.get();

    tilePresetSel.value = appState.settings.tilePreset;

    tilePresetSel.onchange = () => {
        const selectedPreset = C.TILE_SERVERS_PREDEFINED.find(p => p.name === tilePresetSel.value);
        if (selectedPreset) {
            tileUrlIn.value = selectedPreset.url;
        } else {
            tileUrlIn.value = '';
        }
    };

    $('#save-tile-btn', formRoot).onclick = withToast(async () => {
        const selectedPresetName = tilePresetSel.value;
        const customUrl = tileUrlIn.value.trim();

        if (!isValidUrl(customUrl)) {
            throw new Error("Invalid tile URL.");
        }

        confSvc.setTilePreset(selectedPresetName, customUrl);
        mapSvc.updTile(customUrl);
    }, "Map tile settings saved.", "Error saving map tile settings");
};
