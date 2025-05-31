import {createEl} from '../utils.js';
import {createModalWrapper, hideModal} from './modals.js';
import {settingsSections} from './settingsConfig.js';
import {renderConfigurableListSetting} from './settingsUtils.js';
import {renderOfflineQueue} from './settings/offlineQueue.js';

const settingsContentRenderer = modalRoot => {
    const settingsSectionsWrapper = createEl('div', { id: 'settings-sections' });

    settingsSections.forEach(section => {
        const sectionEl = createEl('section', {}, [createEl('h3', { textContent: section.title })]);
        switch (section.type) {
            case 'list':
                renderConfigurableListSetting(settingsSectionsWrapper, section);
                break;
            case 'section':
                sectionEl.appendChild(section.renderer(settingsSectionsWrapper));
                settingsSectionsWrapper.appendChild(sectionEl);
                settingsSectionsWrapper.appendChild(createEl('hr'));
                break;
            case 'offline-queue':
                sectionEl.append(
                    createEl('p', { textContent: 'Events waiting to be published when online.' }),
                    createEl('div', { id: section.listId })
                );
                settingsSectionsWrapper.appendChild(sectionEl);
                settingsSectionsWrapper.appendChild(createEl('hr'));
                renderOfflineQueue(settingsSectionsWrapper);
                break;
        }
    });
    return settingsSectionsWrapper;
};

export function SettPanComp() {
    const modalElement = createModalWrapper('settings-modal', 'Settings', settingsContentRenderer);
    modalElement.querySelector('.modal-content').appendChild(createEl('button', { type: 'button', class: 'secondary', textContent: 'Close', onclick: () => hideModal('settings-modal'), style: 'margin-top:1rem' }));
    return modalElement;
}
