import {createEl} from '../../utils.js';
import {Modal} from '../modals.js';
import {settingsSections} from '../settingsConfig.js';

export class SettingsModal extends Modal {
    constructor() {
        let settingsContent;
        const contentRenderer = () => {
            settingsContent = createEl('div', { id: 'settings-sections' });
            settingsSections.forEach(sectionConfig => {
                const sectionEl = createEl('section');
                sectionEl.appendChild(createEl('h3', { textContent: sectionConfig.title }));

                let renderedContent;
                if (sectionConfig.type === 'offline-queue') {
                    sectionEl.appendChild(createEl('p', { textContent: 'Events waiting to be published when online.' }));
                    const sectionInstance = new sectionConfig.renderer(sectionConfig);
                    renderedContent = sectionInstance.element;
                } else {
                    const sectionInstance = new sectionConfig.renderer(sectionConfig);
                    renderedContent = sectionInstance.element;
                }

                if (Array.isArray(renderedContent)) renderedContent.forEach(el => sectionEl.appendChild(el));
                else if (renderedContent instanceof Node) sectionEl.appendChild(renderedContent);
                settingsContent.appendChild(sectionEl);
                settingsContent.appendChild(createEl('hr'));
            });
            settingsContent.appendChild(createEl('button', { type: 'button', class: 'secondary', textContent: 'Close', onclick: () => this.hide(), style: 'margin-top:1rem' }));
            return settingsContent;
        };
        super('settings-modal', 'Settings', contentRenderer);
    }
}
