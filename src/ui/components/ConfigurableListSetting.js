import {appStore} from '../../store.js';
import {createEl} from '../../utils.js';
import {renderForm, renderList} from '../forms.js';
import {withToast} from '../../decorators.js';

export class ConfigurableListSetting {
    constructor(config) {
        this.config = config;
        this.sectionEl = createEl('section');
        this.listContainer = createEl('div', {class: 'configurable-list-container'});
        this.form = null;

        this.sectionEl.appendChild(createEl('h3', {textContent: config.title}));
        this.sectionEl.appendChild(this.listContainer);

        let formFieldsMap = {};
        if (config.formFields) {
            const {form, fields} = renderForm(config.formFields, {}, {class: 'configurable-list-form'});
            this.form = form;
            formFieldsMap = fields;
            this.sectionEl.appendChild(this.form);
        }

        this.listRenderer();

        const wrapWithToast = (fn, successMsg, errorMsg) => withToast(async () => {
            await fn();
            this.listRenderer();
            return successMsg;
        }, null, errorMsg);

        if (config.addInputRef && config.addBtnRef && config.addLogic && this.form) {
            const addInputEl = formFieldsMap[config.addInputRef];
            const addBtnEl = formFieldsMap[config.addBtnRef];

            addBtnEl.onclick = wrapWithToast(async () => {
                const inputValue = addInputEl.value.trim();
                await config.addLogic(inputValue);
                addInputEl.value = '';
            }, config.addSuccessMsg, config.addErrorMsg);
        }

        if (config.saveBtnRef && config.onSaveCallback && this.form) {
            const saveBtnEl = formFieldsMap[config.saveBtnRef];
            saveBtnEl.onclick = wrapWithToast(async () => {
                await config.onSaveCallback();
            }, "Settings saved.", "Error saving settings");
        }

        if (config.uniqueListenersSetup && this.form) {
            config.uniqueListenersSetup(formFieldsMap);
        }

        this.unsubscribe = appStore.on((newState, oldState) => {
            const currentItems = this.config.getItems(newState);
            const oldItems = this.config.getItems(oldState);
            if (JSON.stringify(currentItems) !== JSON.stringify(oldItems)) {
                this.listRenderer();
            }
        });
    }

    listRenderer() {
        const items = this.config.getItems(appStore.get());
        renderList(this.listContainer, items || [], this.config.itemRenderer, this.config.actionsConfig, this.config.itemWrapperClass);
    }

    get element() {
        return this.sectionEl;
    }
}
