import {appStore} from '../../store.js';
import {createEl} from '../../utils.js';
import {renderForm, renderList, setupAddRemoveListSection} from '../forms.js';

export function ConfigurableListSetting(config) {
    const sectionEl = createEl('section', {}, [
        createEl('h3', { textContent: config.title }),
        createEl('div', { id: config.listId }),
        config.formFields ? renderForm(config.formFields, {}, { id: config.formId }) : null
    ].filter(Boolean)));

    const listRenderer = () => {
        const items = config.getItems();
        renderList(config.listId, items || [], config.itemRenderer, config.actionsConfig, config.itemWrapperClass, sectionEl);
    };

    if (config.addInputId && config.addBtnId && config.addLogic) {
        setupAddRemoveListSection({
            modalContent: sectionEl,
            addInputId: config.addInputId,
            addBtnId: config.addBtnId,
            addLogic: config.addLogic,
            listRenderer,
            saveBtnId: config.saveBtnId,
            onSaveCallback: config.onSaveCallback,
            successMsg: config.addSuccessMsg,
            errorMsg: config.addErrorMsg
        });
    }

    listRenderer();

    config.uniqueListenersSetup?.(sectionEl);

    return sectionEl;
}
