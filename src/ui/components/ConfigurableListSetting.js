import {appStore} from '../../store.js';
import {createEl} from '../../utils.js';
import {renderForm, renderList, setupAddRemoveListSection} from '../forms.js';

export class ConfigurableListSetting {
    constructor(config) {
        this.config = config;
        this.sectionEl = createEl('section');
        this.listContainer = createEl('div', { id: config.listId });
        this.form = null;

        this.sectionEl.appendChild(createEl('h3', { textContent: config.title }));
        this.sectionEl.appendChild(this.listContainer);

        if (config.formFields) {
            this.form = renderForm(config.formFields, {}, { id: config.formId });
            this.sectionEl.appendChild(this.form);
        }

        this.listRenderer();

        if (config.addInputId && config.addBtnId && config.addLogic && this.form) {
            const addInputEl = this.form.querySelector(`#${config.addInputId}`);
            const addBtnEl = this.form.querySelector(`#${config.addBtnId}`);
            const saveBtnEl = config.saveBtnId ? this.form.querySelector(`#${config.saveBtnId}`) : null;

            setupAddRemoveListSection({
                addInputEl,
                addBtnEl,
                addLogic: config.addLogic,
                listRenderer: this.listRenderer.bind(this),
                saveBtnEl,
                onSaveCallback: config.onSaveCallback,
                successMsg: config.addSuccessMsg,
                errorMsg: config.addErrorMsg
            });
        }

        if (config.uniqueListenersSetup && this.form) {
            const importContactsBtn = this.form.querySelector('#import-contacts-btn');
            const publishContactsBtn = this.form.querySelector('#publish-contacts-btn');
            if (importContactsBtn && publishContactsBtn) {
                config.uniqueListenersSetup(importContactsBtn, publishContactsBtn);
            }
        }
    }

    listRenderer() {
        const items = this.config.getItems();
        renderList(this.listContainer, items || [], this.config.itemRenderer, this.config.actionsConfig, this.config.itemWrapperClass);
    }

    get element() {
        return this.sectionEl;
    }
}
