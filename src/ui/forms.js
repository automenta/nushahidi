import {createEl, sanitizeHTML, showToast} from '../utils.js';
import {showConfirmModal} from './modals.js';

export function renderForm(fieldsConfig, initialData = {}, formOptions = {}) {
    const form = createEl('form', {...formOptions});
    const fields = {};

    if (formOptions.onSubmit) form.onsubmit = formOptions.onSubmit;

    for (const field of fieldsConfig) {
        const fieldId = field.id || `field-${field.name || 'anon'}-${Math.random().toString(36).substring(2, 9)}`;
        const commonAttrs = {id: fieldId, name: field.name, required: field.required || false};
        const initialValue = initialData[field.name] ?? field.value ?? '';

        if (field.label && !['button', 'custom-html', 'paragraph', 'hr', 'checkbox', 'h4'].includes(field.type)) {
            form.appendChild(createEl('label', {for: fieldId, textContent: field.label}));
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
                    placeholder: field.placeholder || '',
                    value: initialValue,
                    autocomplete: field.autocomplete || 'off',
                    readOnly: field.readOnly || false,
                    ...commonAttrs,
                    ...field.attributes // Allow additional attributes from field config
                }, [], fields);
                break;
            case 'textarea':
                inputElement = createEl('textarea', {
                    placeholder: field.placeholder || '',
                    rows: field.rows || 3,
                    textContent: initialValue,
                    ...commonAttrs,
                    ...field.attributes
                }, [], fields);
                break;
            case 'select':
                inputElement = createEl('select', {class: field.class || '', ...commonAttrs, ...field.attributes},
                    field.options.map(opt => createEl('option', {
                        value: opt.value,
                        textContent: opt.label,
                        selected: initialValue === opt.value
                    }))
                , fields);
                break;
            case 'checkbox-group':
                inputElement = createEl('div', {id: fieldId, class: field.class || '', ...field.attributes}, [], fields);
                field.options.forEach(opt => inputElement.appendChild(createEl('label', {}, [
                    createEl('input', {type: 'checkbox', name: field.name, value: opt.value, checked: initialData[field.name]?.includes(opt.value) || false}),
                    ` ${sanitizeHTML(opt.label)}`
                ])));
                break;
            case 'checkbox':
                inputElement = createEl('label', {}, [
                    createEl('input', {type: 'checkbox', id: fieldId, name: field.name, checked: initialData[field.name] || false}),
                    ` ${sanitizeHTML(field.label)}`
                ]);
                if (field.onchange) inputElement.querySelector('input').addEventListener('change', field.onchange);
                break;
            case 'file':
                inputElement = createEl('input', {type: 'file', multiple: field.multiple || false, accept: field.accept || '', ...commonAttrs, ...field.attributes}, [], fields);
                if (field.onchange) inputElement.addEventListener('change', field.onchange);
                break;
            case 'button':
                inputElement = createEl('button', {
                    type: field.buttonType || 'button',
                    textContent: field.label,
                    class: field.class || '',
                    style: field.style || '',
                    ...commonAttrs,
                    ...field.attributes
                }, [], fields);
                if (field.onclick) inputElement.onclick = field.onclick;
                break;
            case 'custom-html':
                inputElement = createEl('div', {id: fieldId, class: field.class || '', innerHTML: field.innerHTML || '', ...field.attributes}, [], fields);
                if (field.content) {
                    (Array.isArray(field.content) ? field.content : [field.content]).filter(Boolean).forEach(child => {
                        if (child instanceof Element) {
                            inputElement.appendChild(child);
                        } else if (typeof child === 'object' && child.tagName) {
                            const nestedElement = createEl(child.tagName, child.attributes, child.children, fields);
                            inputElement.appendChild(nestedElement);
                        } else {
                            inputElement.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
                        }
                    });
                }
                break;
            case 'paragraph':
                inputElement = createEl('p', {class: field.class || '', innerHTML: field.innerHTML || '', ...field.attributes}, field.content || [], fields);
                break;
            case 'hr':
                inputElement = createEl('hr', {...field.attributes}, [], fields);
                break;
            case 'h4':
                inputElement = createEl('h4', {textContent: field.content[0], ...field.attributes}, [], fields);
                break;
            case 'radio-group':
                inputElement = createEl('div', {id: fieldId, class: field.class || '', ...field.attributes}, [], fields);
                field.options.forEach(opt => {
                    const radio = createEl('input', {
                        type: 'radio',
                        name: field.name,
                        value: opt.value,
                        checked: initialValue === opt.value,
                    });
                    if (opt.onchange) radio.onchange = opt.onchange;
                    inputElement.appendChild(createEl('label', {}, [radio, ` ${sanitizeHTML(opt.label)}`]));
                });
                break;
            default:
                console.warn(`Unknown field type: ${field.type}`);
                return;
        }
        form.appendChild(inputElement);
        if (field.ref) { // This is for top-level refs defined in the field config itself
            fields[field.ref] = inputElement;
        }
    }
    return {form, fields};
}

export const renderList = (containerElement, items, ItemComponent, actionsConfig, itemWrapperClass) => {
    if (!containerElement) {
        console.warn(`Container element not found for list rendering.`);
        return;
    }
    containerElement.innerHTML = '';

    if (!items.length) {
        containerElement.textContent = `No items configured.`;
        return;
    }

    items.forEach((item, index) => {
        const itemInstance = new ItemComponent(item);
        const itemDiv = createEl('div', {class: itemWrapperClass});

        itemDiv.appendChild(itemInstance.element);

        actionsConfig.forEach(action => {
            const actionBtn = createEl('button', {
                type: 'button',
                class: action.className,
                textContent: action.label,
                onclick: () => {
                    action.confirm ?
                        showConfirmModal(action.confirm.title, action.confirm.message, () => action.onClick(item, index), () => showToast("Action cancelled.", 'info')) :
                        action.onClick(item, index);
                }
            });
            itemDiv.appendChild(actionBtn);
        });
        containerElement.appendChild(itemDiv);
    });
};
