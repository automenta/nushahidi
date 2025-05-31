import {appStore} from '../../store.js';
import {confSvc, mapSvc} from '../../services.js';
import {C, isValidUrl, createEl} from '../../utils.js';
import {withToast} from '../../decorators.js';
import {renderForm} from '../forms.js';

export class MapTilesSection {
    constructor() {
        this.sectionEl = createEl('section');
        this.sectionEl.appendChild(createEl('h3', {textContent: 'Map Tiles'}));
        this.form = null;
        this.tilePresetSel = null;
        this.tileUrlIn = null;
        this.saveTileBtn = null;

        // Initial render
        this.createFormElements(appStore.get());
        this.sectionEl.appendChild(this.form);

        this.unsubscribe = appStore.on((newState, oldState) => {
            if (newState.settings.tilePreset !== oldState?.settings?.tilePreset || newState.settings.tileUrl !== oldState?.settings?.tileUrl) {
                this.updateFormElements(newState); // Granular update
            }
        });
    }

    createFormElements(appState) {
        const mapTilesFormFields = [
            {
                label: 'Tile Server Preset:',
                type: 'select',
                ref: 'tilePresetSelect',
                name: 'tilePreset',
                value: appState.settings.tilePreset,
                options: C.TILE_SERVERS_PREDEFINED.map(p => ({value: p.name, label: p.name}))
            },
            {label: 'Custom Tile URL Template:', type: 'url', ref: 'tileUrlInput', name: 'tileUrl', value: appState.settings.tileUrl},
            {type: 'button', ref: 'saveTileBtn', label: 'Save Map Tiles', buttonType: 'button'}
        ];

        const {form, fields} = renderForm(mapTilesFormFields, {}, {class: 'map-tiles-form'});
        this.form = form;
        this.tilePresetSel = fields.tilePresetSelect;
        this.tileUrlIn = fields.tileUrlInput;
        this.saveTileBtn = fields.saveTileBtn;

        this.tilePresetSel.onchange = () => {
            const selectedPreset = C.TILE_SERVERS_PREDEFINED.find(p => p.name === this.tilePresetSel.value);
            this.tileUrlIn.value = selectedPreset?.url || '';
        };

        this.saveTileBtn.onclick = withToast(async () => {
            const selectedPresetName = this.tilePresetSel.value;
            const customUrl = this.tileUrlIn.value.trim();

            if (!isValidUrl(customUrl)) throw new Error("Invalid tile URL.");

            await confSvc.setTilePreset(selectedPresetName, customUrl);
            mapSvc.updTile(customUrl);
        }, "Map tile settings saved.", "Error saving map tile settings");
    }

    updateFormElements(appState) {
        this.tilePresetSel.value = appState.settings.tilePreset;
        this.tileUrlIn.value = appState.settings.tileUrl;
    }

    get element() {
        return this.sectionEl;
    }
}
