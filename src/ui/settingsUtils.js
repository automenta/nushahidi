import { appStore } from '../store.js';
import { confSvc, nostrSvc, dbSvc } from '../services.js';
import { C, createEl, showToast, npubToHex, formatNpubShort, sanitizeHTML } from '../utils.js';
import { renderForm, renderList, setupAddRemoveListSection } from '../forms.js';
import { showConfirmModal } from '../modals.js';
import { withLoading, withToast } from '../decorators.js';

export function renderConfigurableListSetting(wrapper, config) {
    wrapper.appendChild(createEl('section', {}, [
        createEl('h3', { textContent: config.title }),
        createEl('div', { id: config.listId }),
        config.formFields ? renderForm(config.formFields, {}, { id: config.formId }) : null
    ].filter(Boolean)));
    wrapper.appendChild(createEl('hr'));

    const listRenderer = () => {
        let items;
        if (config.listId === 'rly-list') {
            items = appStore.get().relays;
        } else if (config.listId === 'followed-list') {
            items = appStore.get().followedPubkeys;
        } else {
            items = appStore.get().settings[config.listId.replace('-list', '')];
        }

        renderList(config.listId, items || [], config.itemRenderer, config.actionsConfig, config.itemWrapperClass, wrapper);
    };

    if (config.addInputId && config.addBtnId && config.addLogic) {
        setupAddRemoveListSection({
            modalContent: wrapper,
            addInputId: config.addInputId,
            addBtnId: config.addBtnId,
            addLogic: config.addLogic,
            listRenderer: listRenderer,
            saveBtnId: config.saveBtnId,
            onSaveCallback: config.onSaveCallback
        });
    } else if (config.saveBtnId && config.onSaveCallback) {
        const saveBtn = $(`#${config.saveBtnId}`, wrapper);
        if (saveBtn) {
            saveBtn.onclick = () => {
                if (config.onSaveCallback) config.onSaveCallback();
                showToast("Settings saved.", 'success');
            };
        }
    }

    listRenderer();

    if (config.uniqueListenersSetup) {
        config.uniqueListenersSetup(wrapper);
    }
}
