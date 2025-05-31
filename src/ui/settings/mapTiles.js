import {appStore} from '../../store.js';
import {confSvc, mapSvc} from '../../services.js';
import {C, isValidUrl, createEl} from '../../utils.js';
import {withToast} from '../../decorators.js';
import {renderForm} from '../forms.js';

export const MapTilesSection = () => {
    let sectionEl;
    let form;
    let tilePresetSel;
    let tileUrlIn;
    let saveTileBtn;

    const render = (appState) => {
        if (!sectionEl) {
            sectionEl = createEl('section');
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
                { type: 'button', id: 'save-tile-btn', label: 'Save Map Tiles', buttonType: 'button' }
            ];

            form = renderForm(mapTilesFormFields, {}, { id: 'map-tiles-form' });
            sectionEl.appendChild(form);

            tilePresetSel = form.querySelector('#tile-preset-sel');
            tileUrlIn = form.querySelector('#tile-url-in');
            saveTileBtn = form.querySelector('#save-tile-btn');

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
        }

        tilePresetSel.value = appState.settings.tilePreset;
        tileUrlIn.value = appState.settings.tileUrl;

        return sectionEl;
    };

    appStore.on((newState, oldState) => {
        if (newState.settings.tilePreset !== oldState?.settings?.tilePreset || newState.settings.tileUrl !== oldState?.settings?.tileUrl) {
            render(newState);
        }
    });

    return render(appStore.get());
};
