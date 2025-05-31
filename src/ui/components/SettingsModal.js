import {createEl} from '../../utils.js';
import {Modal} from '../modals.js';
import {settingsSections} from '../settingsConfig.js';

export class SettingsModal extends Modal {
    constructor() {
        const contentRenderer = () => {
            const settingsContent = createEl('div', {class: 'settings-sections'});
            settingsSections.forEach(sectionConfig => {
                const SectionComponent = sectionConfig.renderer;
                const sectionInstance = new SectionComponent(sectionConfig);
                settingsContent.appendChild(sectionInstance.element);
                settingsContent.appendChild(createEl('hr'));
            });
            settingsContent.appendChild(createEl('button', {type: 'button', class: 'secondary', textContent: 'Close', onclick: () => this.hide(), style: 'margin-top:1rem'}));
            return settingsContent;
        };
        super('settings-modal', 'Settings', contentRenderer);
    }
}
