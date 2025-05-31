import {createEl} from '../utils.js';
import {createModalWrapper, hideModal} from './modals.js';
import {settingsSections} from './settingsConfig.js';
import {renderConfigurableListSetting} from './settingsUtils.js';
import {renderOfflineQueue} from './settings/offlineQueue.js';

const settingsContentRenderer = modalRoot => {
    const settingsSectionsWrapper = createEl('div', { id: 'settings-sections' });

    settingsSections.forEach(section => {
        if (section.type === 'list') {
            renderConfigurableListSetting(settingsSectionsWrapper, section);
        } else {
            const sectionEl = createEl('section', {}, [createEl('h3', { textContent: section.title })]);
            if (section.type === 'section') {
                const renderedContent = section.renderer(settingsSectionsWrapper);
                if (Array.isArray(renderedContent)) {
                    renderedContent.forEach(el => sectionEl.appendChild(el));
                } else if (renderedContent instanceof Node) {
                    sectionEl.appendChild(renderedContent);
                }
            } else if (section.type === 'offline-queue') {
                sectionEl.append(
                    createEl('p', { textContent: 'Events waiting to be published when online.' }),
                    createEl('div', { id: section.listId })
                );
            }
            settingsSectionsWrapper.appendChild(sectionEl);
            settingsSectionsWrapper.appendChild(createEl('hr'));
            if (section.type === 'offline-queue') {
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
