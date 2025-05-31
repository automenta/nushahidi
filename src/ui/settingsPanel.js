import {createEl} from '../utils.js';
import {createModalWrapper, hideModal} from './modals.js';
import {settingsSections} from './settingsConfig.js';
import {renderConfigurableListSetting} from './settingsUtils.js';
import {renderOfflineQueue} from './settings/offlineQueue.js';

const settingsContentRenderer = modalRoot => {
    const settingsSectionsWrapper = createEl('div', { id: 'settings-sections' });

    settingsSections.forEach(section => {
        const sectionEl = createEl('section', {}, [createEl('h3', { textContent: section.title })]);
        if (section.type === 'list') {
            renderConfigurableListSetting(settingsSectionsWrapper, section);
        } else if (section.type === 'section') {
            const renderedContent = section.renderer(settingsSectionsWrapper);
            if (renderedContent) sectionEl.appendChild(renderedContent);
            settingsSectionsWrapper.appendChild(sectionEl);
            settingsSectionsWrapper.appendChild(createEl('hr'));
        } else if (section.type === 'offline-queue') {
            sectionEl.appendChild(createEl('p', { textContent: 'Events waiting to be published when online.' }));
            sectionEl.appendChild(createEl('div', { id: section.listId }));
            settingsSectionsWrapper.appendChild(sectionEl);
            settingsSectionsWrapper.appendChild(createEl('hr'));
            renderOfflineQueue(settingsSectionsWrapper);
        }
    });

    return settingsSectionsWrapper;
};

export function SettPanComp() {
    const modalContent = createModalWrapper('settings-modal', 'Settings', settingsContentRenderer);
    modalContent.appendChild(createEl('button', { type: 'button', class: 'secondary', textContent: 'Close', onclick: () => hideModal('settings-modal'), style: 'margin-top:1rem' }));
    return modalContent;
}
