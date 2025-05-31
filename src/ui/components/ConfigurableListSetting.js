import {appStore} from '../../store.js';
import {createEl} from '../../utils.js';
import {renderForm, renderList, setupAddRemoveListSection} from '../forms.js';

export function ConfigurableListSetting(config) {
    const sectionEl = createEl('section', {}, [
        createEl('h3', { textContent: config.title }),
        createEl('div', { id: config.listId }),
    ].filter(Boolean));

    let form;
    if (config.formFields) {
        form = renderForm(config.formFields, {}, { id: config.formId });
        sectionEl.appendChild(form);
    }

    const listContainer = sectionEl.querySelector(`#${config.listId}`);

    const listRenderer = () => {
        const items = config.getItems();
        renderList(listContainer, items || [], config.itemRenderer, config.actionsConfig, config.itemWrapperClass);
    };

    if (config.addInputId && config.addBtnId && config.addLogic && form) {
        const addInputEl = form.querySelector(`#${config.addInputId}`);
        const addBtnEl = form.querySelector(`#${config.addBtnId}`);
        const saveBtnEl = config.saveBtnId ? form.querySelector(`#${config.saveBtnId}`) : null;

        setupAddRemoveListSection({
            addInputEl,
            addBtnEl,
            addLogic: config.addLogic,
            listRenderer,
            saveBtnEl,
            onSaveCallback: config.onSaveCallback,
            successMsg: config.addSuccessMsg,
            errorMsg: config.addErrorMsg
        });
    }

    listRenderer();

    if (config.uniqueListenersSetup && form) {
        const importContactsBtn = form.querySelector('#import-contacts-btn');
        const publishContactsBtn = form.querySelector('#publish-contacts-btn');
        if (importContactsBtn && publishContactsBtn) {
            config.uniqueListenersSetup(importContactsBtn, publishContactsBtn);
        }
    }

    return sectionEl;
}
