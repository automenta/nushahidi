import {createEl} from '../../utils.js';
import {Modal, hideModal} from '../modals.js';
import {settingsSections} from '../settingsConfig.js';

export function SettingsModal() {
    let settingsModalElement;
    let settingsContent;

    const sectionRenderers = new Map([
        ['list', (wrapper, section) => wrapper.appendChild(section.renderer(section))],
        ['section', (wrapper, section) => {
            const sectionEl = createEl('section', {}, [createEl('h3', { textContent: section.title })]);
            const renderedContent = section.renderer();
            if (Array.isArray(renderedContent)) renderedContent.forEach(el => sectionEl.appendChild(el));
            else if (renderedContent instanceof Node) sectionEl.appendChild(renderedContent);
            wrapper.appendChild(sectionEl);
        }],
        ['offline-queue', (wrapper, section) => {
            const sectionEl = createEl('section', {}, [createEl('h3', { textContent: section.title })]);
            sectionEl.append(
                createEl('p', { textContent: 'Events waiting to be published when online.' }),
                section.renderer(section)
            );
            wrapper.appendChild(sectionEl);
        }]
    ]);

    const contentRenderer = () => {
        settingsContent = createEl('div', { id: 'settings-sections' });
        settingsSections.forEach(section => {
            const renderer = sectionRenderers.get(section.type);
            if (renderer) {
                renderer(settingsContent, section);
                settingsContent.appendChild(createEl('hr'));
            }
        });
        settingsContent.appendChild(createEl('button', { type: 'button', class: 'secondary', textContent: 'Close', onclick: () => hideModal(settingsModalElement), style: 'margin-top:1rem' }));
        return settingsContent;
    };

    settingsModalElement = Modal('settings-modal', 'Settings', contentRenderer);
    return settingsModalElement;
}
