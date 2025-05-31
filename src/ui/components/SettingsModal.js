import {createEl} from '../../utils.js';
import {Modal, hideModal} from '../modals.js';
import {settingsSections} from '../settingsConfig.js';
import {ConfigurableListSetting} from './ConfigurableListSetting.js';
import {renderOfflineQueue} from '../settings/offlineQueue.js';

export function SettingsModal() {
    let settingsModalElement;

    const sectionRenderers = new Map([
        ['list', (wrapper, section) => wrapper.appendChild(ConfigurableListSetting(section, wrapper))],
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

    settingsModalElement = Modal('settings-modal', 'Settings', settingsContentRenderer);
    settingsModalElement.querySelector('.modal-content').appendChild(createEl('button', { type: 'button', class: 'secondary', textContent: 'Close', onclick: () => hideModal(settingsModalElement), style: 'margin-top:1rem' }));
    return settingsModalElement;
}
