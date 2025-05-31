import {createEl} from '../../utils.js';
import {Modal} from '../modals.js';
import {settingsSections} from '../settingsConfig.js';

export class SettingsModal extends Modal {
    constructor() {
        const contentRenderer = (contentRoot, modalRoot) => {
            const settingsContent = createEl('div', { class: 'settings-sections' });
            settingsSections.forEach(sectionConfig => {
                const sectionEl = createEl('section');
                sectionEl.appendChild(createEl('h3', { textContent: sectionConfig.title }));

                const sectionInstance = new sectionConfig.renderer(sectionConfig);
                const renderedContent = sectionInstance.element;

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
