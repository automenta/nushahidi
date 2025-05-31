import {appStore} from '../../store.js';
import {createEl} from '../../utils.js';
import {renderForm, renderList} from '../forms.js';
import {withLoading, withToast} from '../../decorators.js';
import {showConfirmModal} from '../modals.js';
import {showToast} from '../../utils.js';
import {nostrSvc, confSvc} from '../../services.js';

export class ConfigurableListSetting {
    constructor(config) {
        this.config = config;
        this.sectionEl = createEl('section');
        this.listContainer = createEl('div', { class: 'configurable-list-container' }); // Use a class instead of ID
        this.form = null;

        this.sectionEl.appendChild(createEl('h3', { textContent: config.title }));
        this.sectionEl.appendChild(this.listContainer);

        if (config.formFields) {
            this.form = renderForm(config.formFields, {}, { class: 'configurable-list-form' }); // Use a class instead of ID
            this.sectionEl.appendChild(this.form);
        }

        this.listRenderer();

        if (config.addInputId && config.addBtnId && config.addLogic && this.form) {
            const addInputEl = this.form.querySelector(`#${config.addInputId}`);
            const addBtnEl = this.form.querySelector(`#${config.addBtnId}`);
            const saveBtnEl = config.saveBtnId ? this.form.querySelector(`#${config.saveBtnId}`) : null;

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
            config.uniqueListenersSetup(this.form);
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
