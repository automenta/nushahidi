import {appStore} from '../../store.js';
import {createEl} from '../../utils.js';
import {renderForm, renderList} from '../forms.js';
import {withLoading, withToast} from '../../decorators.js';

export class ConfigurableListSetting {
    constructor(config) {
        this.config = config;
        this.sectionEl = createEl('section');
        this.listContainer = createEl('div', { class: 'configurable-list-container' });
        this.form = null;

        this.sectionEl.appendChild(createEl('h3', { textContent: config.title }));
        this.sectionEl.appendChild(this.listContainer);

        let formFieldsMap = {};
        if (config.formFields) {
            const { form, fields } = renderForm(config.formFields, {}, { class: 'configurable-list-form' });
            this.form = form;
            formFieldsMap = fields;
            this.sectionEl.appendChild(this.form);
        }

        this.listRenderer();

        if (config.addInputRef && config.addBtnRef && config.addLogic && this.form) {
            const addInputEl = formFieldsMap[config.addInputRef];
            const addBtnEl = formFieldsMap[config.addBtnRef];
            const saveBtnEl = config.saveBtnRef ? formFieldsMap[config.saveBtnRef] : null;

            addBtnEl.onclick = withToast(async () => {
                const inputValue = addInputEl.value.trim();
                await config.addLogic(inputValue);
                addInputEl.value = '';
                this.listRenderer();
            }, config.addSuccessMsg, config.addErrorMsg);

            if (saveBtnEl) saveBtnEl.onclick = withToast(async () => {
                await config.onSaveCallback?.();
            }, "Settings saved.", "Error saving settings");
        }

        if (config.uniqueListenersSetup && this.form) {
            config.uniqueListenersSetup(formFieldsMap);
        }

        this.unsubscribe = appStore.on((newState, oldState) => {
            const currentItems = this.config.getItems();
            const oldItems = this.config.getItems.call(null, oldState);
            if (JSON.stringify(currentItems) !== JSON.stringify(oldItems)) {
                this.listRenderer();
            }
        });
    }

    listRenderer() {
        const items = this.config.getItems();
        renderList(this.listContainer, items || [], this.config.itemRenderer, this.config.actionsConfig, this.config.itemWrapperClass);
    }

    get element() {
        return this.sectionEl;
    }
}
