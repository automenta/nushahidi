import {appStore} from '../../store.js';
import {confSvc, mapSvc} from '../../services.js';
import {C, isValidUrl, createEl} from '../../utils.js';
import {withToast} from '../../decorators.js';
import {renderForm} from '../forms.js';

export const MapTilesSection = () => {
    const sectionEl = document.createElement('section');
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
    sectionEl.appendChild(form);

    const tilePresetSel = form.querySelector('#tile-preset-sel');
    const tileUrlIn = form.querySelector('#tile-url-in');
    const saveTileBtn = form.querySelector('#save-tile-btn');

    tilePresetSel.value = appState.settings.tilePreset;

    tilePresetSel.onchange = () => {
        const selectedPreset = C.TILE_SERVERS_PREDEFINED.find(p => p.name === tilePresetSel.value);
        tileUrlIn.value = selectedPreset?.url || '';
    };

    saveTileBtn.onclick = withToast(async () => {
        const selectedPresetName = tilePresetSel.value;
        const customUrl = tileUrlIn.value.trim();

        if (!isValidUrl(customUrl)) throw new Error("Invalid tile URL.");

        await confSvc.setTilePreset(selectedPresetName, customUrl);
        mapSvc.updTile(customUrl);
    }, "Map tile settings saved.", "Error saving map tile settings");

    return sectionEl;
};
