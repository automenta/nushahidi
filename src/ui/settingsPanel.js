import {createEl} from '../utils.js';
import {createModalWrapper, hideModal} from './modals.js';
import {settingsSections} from './settingsConfig.js';
import {renderConfigurableListSetting} from './settingsUtils.js';
import {renderOfflineQueue} from './settings/offlineQueue.js';

const sectionRenderers = new Map([
    ['list', (wrapper, section) => renderConfigurableListSetting(wrapper, section)],
    ['section', (wrapper, section) => {
        const sectionEl = createEl('section', {}, [createEl('h3', { textContent: section.title })]);
        const renderedContent = section.renderer(wrapper);
        if (Array.isArray(renderedContent)) renderedContent.forEach(el => sectionEl.appendChild(el));
        else if (renderedContent instanceof Node) sectionEl.appendChild(renderedContent);
        wrapper.appendChild(sectionEl);
    }],
    ['offline-queue', (wrapper, section) => {
        const sectionEl = createEl('section', {}, [createEl('h3', { textContent: section.title })]);
        sectionEl.append(
            createEl('p', { textContent: 'Events waiting to be published when online.' }),
            createEl('div', { id: section.listId })
        );
        wrapper.appendChild(sectionEl);
        renderOfflineQueue(wrapper);
    }]
]);

const settingsContentRenderer = modalRoot => {
    const settingsSectionsWrapper = createEl('div', { id: 'settings-sections' });

    settingsSections.forEach(section => {
        const renderer = sectionRenderers.get(section.type);
        if (renderer) {
            renderer(settingsSectionsWrapper, section);
            settingsSectionsWrapper.appendChild(createEl('hr'));
        }
    });
    return settingsSectionsWrapper;
};

export function SettPanComp() {
    const modalElement = createModalWrapper('settings-modal', 'Settings', settingsContentRenderer);
    modalElement.querySelector('.modal-content').appendChild(createEl('button', { type: 'button', class: 'secondary', textContent: 'Close', onclick: () => hideModal('settings-modal'), style: 'margin-top:1rem' }));
    return modalElement;
}
