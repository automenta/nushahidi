import {$, createEl, sanitizeHTML, showToast} from '../utils.js';
import {showConfirmModal} from './modals.js';

export function renderForm(fieldsConfig, initialData = {}, formOptions = {}) {
    const form = createEl('form', { id: formOptions.id || 'dynamic-form' });
    if (formOptions.onSubmit) {
        form.onsubmit = formOptions.onSubmit;
    }

    for (const field of fieldsConfig) {
        const fieldId = field.id || (field.name ? `field-${field.name}` : null);

        if (field.label && field.type !== 'button' && field.type !== 'custom-html' && field.type !== 'paragraph' && field.type !== 'hr' && field.type !== 'checkbox' && field.type !== 'h4') {
            form.appendChild(createEl('label', { for: fieldId, textContent: field.label }));
        }

        let inputElement;
        switch (field.type) {
            case 'text':
            case 'password':
            case 'url':
            case 'email':
            case 'search':
            case 'datetime-local':
                inputElement = createEl('input', {
                    type: field.type,
                    id: fieldId,
                    name: field.name,
                    placeholder: field.placeholder || '',
                    value: initialData[field.name] !== undefined ? initialData[field.name] : (field.value || ''),
                    required: field.required || false,
                    autocomplete: field.autocomplete || 'off',
                    readOnly: field.readOnly || false,
                });
                break;
            case 'textarea':
                inputElement = createEl('textarea', {
                    id: fieldId,
                    name: field.name,
                    placeholder: field.placeholder || '',
                    rows: field.rows || 3,
                    required: field.required || false,
                    textContent: initialData[field.name] !== undefined ? initialData[field.name] : (field.value || '')
                });
                break;
            case 'select':
                inputElement = createEl('select', {
                    id: fieldId,
                    name: field.name,
                    required: field.required || false,
                    class: field.class || ''
                }, field.options.map(opt => createEl('option', {
                    value: opt.value,
                    textContent: opt.label,
                    selected: (initialData[field.name] !== undefined && initialData[field.name] === opt.value) || (field.value !== undefined && field.value === opt.value)
                })));
                break;
            case 'checkbox-group':
                inputElement = createEl('div', { id: fieldId, class: field.class || '' });
                field.options.forEach(opt => {
                    inputElement.appendChild(createEl('label', {}, [
                        createEl('input', {
                            type: 'checkbox',
                            name: field.name,
                            value: opt.value,
                            checked: initialData[field.name]?.includes(opt.value) || false
                        }),
                        ` ${sanitizeHTML(opt.label)}`
                    ]));
                });
                break;
            case 'checkbox':
                inputElement = createEl('label', {}, [
                    createEl('input', {
                        type: 'checkbox',
                        id: fieldId,
                        name: field.name,
                        checked: initialData[field.name] || false,
                    }),
                    ` ${sanitizeHTML(field.label)}`
                ]);
                if (field.onchange) {
                    inputElement.querySelector('input').addEventListener('change', field.onchange);
                }
                break;
            case 'file':
                inputElement = createEl('input', {
                    type: 'file',
                    id: fieldId,
                    name: field.name,
                    multiple: field.multiple || false,
                    accept: field.accept || ''
                });
                if (field.onchange) {
                    inputElement.addEventListener('change', field.onchange);
                }
                break;
            case 'button':
                inputElement = createEl('button', {
                    type: field.buttonType || 'button',
                    id: fieldId,
                    textContent: field.label,
                    class: field.class || '',
                    style: field.style || ''
                });
                if (field.onclick) {
                    inputElement.onclick = field.onclick;
                }
                break;
            case 'custom-html':
                inputElement = createEl('div', { id: fieldId, class: field.class || '', innerHTML: field.innerHTML || '' }, field.content || []);
                break;
            case 'paragraph':
                inputElement = createEl('p', { class: field.class || '', innerHTML: field.innerHTML || '' }, field.content || []);
                break;
            case 'hr':
                inputElement = createEl('hr');
                break;
            case 'h4':
                inputElement = createEl('h4', { textContent: field.content[0] });
                break;
            case 'radio-group':
                inputElement = createEl('div', { id: fieldId, class: field.class || '' });
                field.options.forEach(opt => {
                    const radio = createEl('input', {
                        type: 'radio',
                        name: field.name,
                        value: opt.value,
                        checked: (initialData[field.name] !== undefined && initialData[field.name] === opt.value) || (field.value !== undefined && field.value === opt.value) || false,
                    });
                    if (opt.onchange) {
                        radio.onchange = opt.onchange;
                    }
                    inputElement.appendChild(createEl('label', {}, [radio, ` ${sanitizeHTML(opt.label)}`]));
                });
                break;
            default:
                console.warn(`Unknown field type: ${field.type}`);
                return;
        }
        form.appendChild(inputElement);
    }

    return form;
}

export const setupAddRemoveListSection = ({
    modalContent,
    addInputId,
    addBtnId,
    addLogic,
    listRenderer,
    saveBtnId,
    onSaveCallback
}) => {
    const addInput = $(`#${addInputId}`, modalContent);
    const addBtn = $(`#${addBtnId}`, modalContent);
    const saveBtn = saveBtnId ? $(`#${saveBtnId}`, modalContent) : null;

    if (!addInput || !addBtn) {
        console.warn(`Missing elements for list setup: input=${addInputId}, button=${addBtnId}`);
        return;
    }

    addBtn.onclick = async () => {
        const inputValue = addInput.value.trim();
        if (!inputValue) {
            showToast("Input cannot be empty.", 'warning');
            return;
        }
        try {
            const added = await addLogic(inputValue);
            if (added) {
                addInput.value = '';
                listRenderer();
            }
        } catch (e) {
            showToast(`Error: ${e.message}`, 'error');
        }
    };

    if (saveBtn) {
        saveBtn.onclick = () => {
            if (onSaveCallback) onSaveCallback();
            showToast("Settings saved.", 'success');
        };
    }
};

export const renderList = (containerId, items, itemRenderer, actionsConfig, itemWrapperClass, scopeElement = document) => {
    const container = $(`#${containerId}`, scopeElement);
    if (!container) {
        console.warn(`Container with ID ${containerId} not found for list rendering.`);
        return;
    }
    container.innerHTML = '';

    if (items.length === 0) {
        container.textContent = `No ${containerId.replace('-', ' ')}s configured.`;
        return;
    }

    items.forEach((item, index) => {
        const itemContent = itemRenderer(item, index);
        const itemDiv = createEl('div', { class: itemWrapperClass });

        if (typeof itemContent === 'string') {
            itemDiv.innerHTML = itemContent;
        } else if (itemContent instanceof Node) {
            itemDiv.appendChild(itemContent);
        } else {
            console.warn('itemRenderer must return a string or HTMLElement.');
            return;
        }

        actionsConfig.forEach(action => {
            const actionBtn = createEl('button', {
                type: 'button',
                class: action.className,
                textContent: action.label,
                onclick: () => {
                    if (action.confirm) {
                        showConfirmModal(
                            action.confirm.title,
                            action.confirm.message,
                            () => action.onClick(item, index),
                            () => showToast("Action cancelled.", 'info')
                        );
                    } else {
                        action.onClick(item, index);
                    }
                }
            });
            itemDiv.appendChild(actionBtn);
        });
        container.appendChild(itemDiv);
    });
};
