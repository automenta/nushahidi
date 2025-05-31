import { createEl } from '../utils.js';
import { createModalWrapper, hideModal } from './modals.js';
import { settingsSections } from './settingsConfig.js';
import { renderConfigurableListSetting } from './settingsUtils.js';
import { renderOfflineQueue } from './settings/offlineQueue.js';


const settingsContentRenderer = (modalRoot) => {
    const settingsSectionsWrapper = createEl('div', { id: 'settings-sections' });

    settingsSections.forEach(section => {
        if (section.type === 'list') {
            renderConfigurableListSetting(settingsSectionsWrapper, section);
        } else if (section.type === 'section') {
            const sectionEl = createEl('section', {}, [createEl('h3', { textContent: section.title })]);
            sectionEl.appendChild(section.renderer(settingsSectionsWrapper));
            settingsSectionsWrapper.appendChild(sectionEl);
            settingsSectionsWrapper.appendChild(createEl('hr'));
        } else if (section.type === 'offline-queue') {
            settingsSectionsWrapper.appendChild(createEl('section', {}, [
                createEl('h3', { textContent: section.title }),
                createEl('p', { textContent: 'Events waiting to be published when online.' }),
                createEl('div', { id: section.listId })
            ]));
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
