import {appStore} from '../store.js';
import {$, createEl, sanitizeHTML} from '../utils.js';

export function Modal(modalId, title, contentRenderer) {
    const existingModal = $(`#${modalId}`);
    if (existingModal) {
        existingModal.remove();
    }

    const modalElement = createEl('div', { id: modalId, class: 'modal', inert: '' });

    const modalContent = createEl('div', { class: 'modal-content' });

    modalElement.append(
        createEl('span', { class: 'close-btn', innerHTML: '&times;', onclick: () => hideModal(modalElement) }),
        createEl('h2', { id: `${modalId}-heading`, textContent: sanitizeHTML(title) }),
        modalContent
    );

    const specificContent = contentRenderer(modalContent);
    if (Array.isArray(specificContent)) specificContent.forEach(el => modalContent.appendChild(el));
    else if (specificContent instanceof Node) modalContent.appendChild(specificContent);

    document.body.appendChild(modalElement);

    return modalElement;
}

export const showConfirmModal = (title, message, onConfirm, onCancel) => {
    const confirmModalElement = Modal('confirm-modal', title, root => [
        createEl('p', { innerHTML: sanitizeHTML(message) }),
        createEl('div', { class: 'confirm-modal-buttons' }, [
            createEl('button', { class: 'cancel-button', textContent: 'Cancel', onclick: () => { hideModal(confirmModalElement); onCancel?.(); } }),
            createEl('button', { class: 'confirm-button', textContent: 'Confirm', onclick: () => { hideModal(confirmModalElement); onConfirm(); } })
        ])
    ]);
    showModal(confirmModalElement, `${confirmModalElement.id}-heading`);
};

export const showPassphraseModal = (title, message) => {
    return new Promise(resolve => {
        const passphraseModalElement = Modal('passphrase-modal', title, root => {
            const passphraseInput = createEl('input', { type: 'password', id: 'passphrase-input', placeholder: 'Enter passphrase', autocomplete: 'current-password' });
            const decryptBtn = createEl('button', {
                class: 'confirm-button', textContent: 'Decrypt',
                onclick: () => { hideModal(passphraseModalElement); resolve(passphraseInput.value); }
            });
            passphraseInput.addEventListener('keydown', e => e.key === 'Enter' && (e.preventDefault(), decryptBtn.click()));

            return [
                createEl('p', { textContent: message }),
                passphraseInput,
                createEl('div', { class: 'confirm-modal-buttons' }, [
                    createEl('button', { class: 'cancel-button', textContent: 'Cancel', onclick: () => { hideModal(passphraseModalElement); resolve(null); } }),
                    decryptBtn
                ])
            ];
        });
        showModal(passphraseModalElement, 'passphrase-input');
    });
};

export const showModal = (modalElement, focusElSelectorOrElement) => {
    if (!modalElement) {
        console.warn('Attempted to show a null modal element.');
        return;
    }
    modalElement.style.display = 'block';
    modalElement.removeAttribute('inert');

    const focusEl = typeof focusElSelectorOrElement === 'string' ? $(focusElSelectorOrElement, modalElement) : focusElSelectorOrElement;
    focusEl?.focus();

    appStore.set(s => ({ ...s, ui: { ...s.ui, modalOpen: modalElement } }));
};

export const hideModal = modalElement => {
    if (!modalElement) {
        console.warn('Attempted to hide a null modal element.');
        return;
    }
    modalElement.style.display = 'none';
    modalElement.setAttribute('inert', '');
    appStore.set(s => ({ ...s.ui, modalOpen: null }));
};
