import { createEl, $, sanitizeHTML } from '../utils.js';
import { showConfirmModal } from './modals.js';
import { showToast } from '../utils.js'; // showToast is a general utility

/**
 * Renders a form based on a configuration array.
 * @param {Array<object>} fieldsConfig - Array of field definitions. Each object:
 *   { type: string, id?: string, name?: string, label?: string, placeholder?: string, value?: any,
 *     required?: boolean, autocomplete?: string, rows?: number, multiple?: boolean, accept?: string,
 *     options?: Array<{value: string, label: string, selected?: boolean, onchange?: function}>,
 *     class?: string, buttonType?: string, onclick?: function, content?: (string|HTMLElement)[],
 *     innerHTML?: string, style?: string }
 * @param {object} initialData - Object with initial values for form fields (keyed by 'name').
 * @param {object} formOptions - Options for the form element itself (e.g., { id: 'my-form', onSubmit: handler }).
 * @returns {HTMLElement} The generated <form> element.
 */
export function renderForm(fieldsConfig, initialData = {}, formOptions = {}) {
    const form = createEl('form', { id: formOptions.id || 'dynamic-form' });
    if (formOptions.onSubmit) {
        form.onsubmit = formOptions.onSubmit;
    }

    fieldsConfig.forEach(field => {
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
            case 'checkbox-group': // For categories
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
            case 'checkbox': // For single checkboxes like spatial filter toggle
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
            case 'custom-html': // For things like location display or image preview
                inputElement = createEl('div', { id: fieldId, class: field.class || '', innerHTML: field.innerHTML || '' }, field.content || []);
                break;
            case 'paragraph':
                inputElement = createEl('p', { class: field.class || '', innerHTML: field.innerHTML || '' }, field.content || []);
                break;
            case 'hr':
                inputElement = createEl('hr');
                break;
            case 'h4': // Added for headings within forms
                inputElement = createEl('h4', { textContent: field.content[0] });
                break;
            case 'radio-group': // For active focus tag
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
    });

    return form;
}

/**
 * Sets up event listeners for adding items to a list and optionally for a save button.
 * This abstracts common logic for list management sections in settings.
 * @param {object} config - Configuration object.
 * @param {HTMLElement} config.modalContent - The root element to scope queries for input/button IDs.
 * @param {string} config.addInputId - ID of the input field for new items.
 * @param {string} config.addBtnId - ID of the button to add new items.
 * @param {function(string): Promise<boolean>} config.addLogic - Async function that takes the input value,
 *   performs validation, checks for existence, adds the item via `confSvc` or similar, and updates `appStore`.
 *   It should return `true` if the item was successfully added, `false` if not (e.g., validation failed, already exists).
 *   It should handle its own `showToast` messages for success/failure.
 * @param {function(): void} config.listRenderer - Function to call to re-render the specific list display.
 * @param {string} [config.saveBtnId] - Optional ID of a separate "Save" button.
 * @param {function(): void} [config.onSaveCallback] - Optional callback for the save button.
 */
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
                addInput.value = ''; // Clear input only on successful add
                listRenderer(); // Re-render the list immediately
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

/**
 * Renders a list of items into a specified container with flexible item rendering and actions.
 * @param {string} containerId - The ID of the container element.
 * @param {Array<object>} items - Array of items to render.
 * @param {function(object, number): (string|HTMLElement)} itemRenderer - Function to render a single item's display content.
 *                                                                 Should return a string (HTML) or a DOM element.
 * @param {Array<object>} actionsConfig - Array of action button configurations for each item.
 *   Each action object: {
 *     label: string,
 *     className: string,
 *     onClick: function(item: object, index: number), // Now passes index
 *     confirm?: { title: string, message: string } // Optional confirmation modal config
 *   }
 * @param {string} itemWrapperClass - CSS class for the div wrapping each item.
 * @param {HTMLElement} [scopeElement=document] - The element to scope queries for containerId.
 */
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

    items.forEach((item, index) => { // Added index here
        const itemContent = itemRenderer(item, index); // Pass index to itemRenderer
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
                type: 'button', // Ensure it's a button, not submit
                class: action.className,
                textContent: action.label,
                onclick: () => {
                    if (action.confirm) {
                        showConfirmModal(
                            action.confirm.title,
                            action.confirm.message,
                            () => action.onClick(item, index), // Pass index to onClick
                            () => showToast("Action cancelled.", 'info')
                        );
                    } else {
                        action.onClick(item, index); // Pass index to onClick
                    }
                }
            });
            itemDiv.appendChild(actionBtn);
        });
        container.appendChild(itemDiv);
    });
};
