import {appStore} from '../store.js';
import {createEl, sanitizeHTML} from '../utils.js';

export function Modal(modalId, title, contentRenderer) {
    const existingModal = document.getElementById(modalId);
    if (existingModal) existingModal.remove();

    const modalElement = createEl('div', { id: modalId, class: 'modal', inert: '' });
    const modalContent = createEl('div', { class: 'modal-content' });

    modalElement.append(
        createEl('span', { class: 'close-btn', innerHTML: '&times;', onclick: () => hideModal(modalElement) }),
        createEl('h2', { id: `${modalId}-heading`, textContent: sanitizeHTML(title) }),
        modalContent
    );

    const contentToAppend = typeof contentRenderer === 'function' ? contentRenderer(modalContent, modalElement) : contentRenderer;
    const contentArray = Array.isArray(contentToAppend) ? contentToAppend : [contentToAppend];
    contentArray.filter(Boolean).forEach(el => modalContent.appendChild(el));

    document.body.appendChild(modalElement);

    return modalElement;
}

export const showConfirmModal = (title, message, onConfirm, onCancel) => {
    let confirmModalElement;
    const contentRenderer = () => [
        createEl('p', { innerHTML: sanitizeHTML(message) }),
        createEl('div', { class: 'confirm-modal-buttons' }, [
            createEl('button', { class: 'cancel-button', textContent: 'Cancel', onclick: () => { hideModal(confirmModalElement); onCancel?.(); } }),
            createEl('button', { class: 'confirm-button', textContent: 'Confirm', onclick: () => { hideModal(confirmModalElement); onConfirm(); } })
        ])
    ];
    confirmModalElement = Modal('confirm-modal', title, contentRenderer);
    showModal(confirmModalElement, confirmModalElement.querySelector(`#${confirmModalElement.id}-heading`));
};

export const showPassphraseModal = (title, message) => {
    return new Promise(resolve => {
        let passphraseModalElement;
        const passphraseInput = createEl('input', { type: 'password', id: 'passphrase-input', placeholder: 'Enter passphrase', autocomplete: 'current-password' });
        const decryptBtn = createEl('button', {
            class: 'confirm-button', textContent: 'Decrypt',
            onclick: () => { hideModal(passphraseModalElement); resolve(passphraseInput.value); }
        });
        passphraseInput.addEventListener('keydown', e => e.key === 'Enter' && (e.preventDefault(), decryptBtn.click()));

        const contentRenderer = () => [
            createEl('p', { textContent: message }),
            passphraseInput,
            createEl('div', { class: 'confirm-modal-buttons' }, [
                createEl('button', { class: 'cancel-button', textContent: 'Cancel', onclick: () => { hideModal(passphraseModalElement); resolve(null); } }),
                decryptBtn
            ])
        ];
        passphraseModalElement = Modal('passphrase-modal', title, contentRenderer);
        showModal(passphraseModalElement, passphraseModalElement.querySelector('#passphrase-input'));
    });
};

export const showModal = (modalElement, focusElOrSelector) => {
    if (!modalElement) return;
    modalElement.style.display = 'block';
    modalElement.removeAttribute('inert');

    let focusEl = null;
    if (focusElOrSelector instanceof Element) focusEl = focusElOrSelector;
    else if (typeof focusElOrSelector === 'string') focusEl = modalElement.querySelector(focusElOrSelector);
    focusEl?.focus();

    appStore.set(s => ({ ...s, ui: { ...s.ui, modalOpen: modalElement } }));
};

export const hideModal = modalElement => {
    if (!modalElement) return;
    modalElement.style.display = 'none';
    modalElement.setAttribute('inert', '');
    appStore.set(s => ({ ...s.ui, modalOpen: null }));
};
