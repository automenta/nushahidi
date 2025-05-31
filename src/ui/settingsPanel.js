import {createEl} from '../utils.js';
import {createModalWrapper, hideModal} from './modals.js';
import {settingsSections} from './settingsConfig.js';
import {renderConfigurableListSetting} from './settingsUtils.js';
import {renderOfflineQueue} from './settings/offlineQueue.js';

const settingsContentRenderer = modalRoot => {
    const settingsSectionsWrapper = createEl('div', { id: 'settings-sections' });

    settingsSections.forEach(section => {
        if (section.type === 'list') {
            // renderConfigurableListSetting already creates the section and appends it to settingsSectionsWrapper,
            // and also appends an <hr> after it.
            renderConfigurableListSetting(settingsSectionsWrapper, section);
        } else {
            // For 'section' and 'offline-queue' types, we manually create the section and hr.
            const sectionEl = createEl('section', {}, [createEl('h3', { textContent: section.title })]);
            if (section.type === 'section') {
                // Assuming section.renderer returns a Node to be appended to sectionEl
                sectionEl.appendChild(section.renderer(settingsSectionsWrapper));
            } else if (section.type === 'offline-queue') {
                sectionEl.append(
                    createEl('p', { textContent: 'Events waiting to be published when online.' }),
                    createEl('div', { id: section.listId }) // This div will be the container for renderOfflineQueue
                );
            }
            settingsSectionsWrapper.appendChild(sectionEl);
            settingsSectionsWrapper.appendChild(createEl('hr')); // Add HR after this section
            if (section.type === 'offline-queue') {
                // This function renders content into the div created above, which is inside sectionEl.
                // It uses settingsSectionsWrapper as the scope to find the list container.
                renderOfflineQueue(settingsSectionsWrapper);
            }
        }
    });
    return settingsSectionsWrapper;
};

export function SettPanComp() {
    const modalElement = createModalWrapper('settings-modal', 'Settings', settingsContentRenderer);
    modalElement.querySelector('.modal-content').appendChild(createEl('button', { type: 'button', class: 'secondary', textContent: 'Close', onclick: () => hideModal('settings-modal'), style: 'margin-top:1rem' }));
    return modalElement;
}
