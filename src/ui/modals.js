import {appStore} from '../store.js';
import {$, createEl, sanitizeHTML} from '../utils.js';

export function Modal(modalId, title, contentRenderer) {
    // Create the main modal element
    const modalElement = createEl('div', { id: modalId, class: 'modal', inert: '' });

    // Create the inner content wrapper
    const modalContent = createEl('div', { class: 'modal-content' });

    // Append static modal parts
    modalElement.append(
        createEl('span', { class: 'close-btn', innerHTML: '&times;', onclick: () => hideModal(modalId) }),
        createEl('h2', { id: `${modalId}-heading`, textContent: sanitizeHTML(title) }),
        modalContent
    );

    // Render specific content into the content wrapper
    const specificContent = contentRenderer(modalContent);
    if (Array.isArray(specificContent)) specificContent.forEach(el => modalContent.appendChild(el));
    else if (specificContent instanceof Node) modalContent.appendChild(specificContent);

    // Append the modal to the body
    document.body.appendChild(modalElement);

    return modalElement;
}

export function showConfirmModal(title, message, onConfirm, onCancel) {
    Modal('confirm-modal', title, root => [
        createEl('p', { innerHTML: sanitizeHTML(message) }),
        createEl('div', { class: 'confirm-modal-buttons' }, [
            createEl('button', { class: 'cancel-button', textContent: 'Cancel', onclick: () => { hideModal('confirm-modal'); onCancel?.(); } }),
            createEl('button', { class: 'confirm-button', textContent: 'Confirm', onclick: () => { hideModal('confirm-modal'); onConfirm(); } })
        ])
    ]);
    showModal('confirm-modal', 'confirm-modal-heading');
}

export function showPassphraseModal(title, message) {
    return new Promise(resolve => {
        Modal('passphrase-modal', title, root => {
            const passphraseInput = createEl('input', { type: 'password', id: 'passphrase-input', placeholder: 'Enter passphrase', autocomplete: 'current-password' });
            const decryptBtn = createEl('button', {
                class: 'confirm-button', textContent: 'Decrypt',
                onclick: () => { hideModal('passphrase-modal'); resolve(passphraseInput.value); }
            });
            passphraseInput.addEventListener('keydown', e => e.key === 'Enter' && (e.preventDefault(), decryptBtn.click()));

            return [
                createEl('p', { textContent: message }),
                passphraseInput,
                createEl('div', { class: 'confirm-modal-buttons' }, [
                    createEl('button', { class: 'cancel-button', textContent: 'Cancel', onclick: () => { hideModal('passphrase-modal'); resolve(null); } }),
                    decryptBtn
                ])
            ];
        });
        showModal('passphrase-modal', 'passphrase-input');
    });
}

export const showModal = (id, focusElId) => {
    const modal = $(`#${id}`);
    if (modal) {
        modal.style.display = 'block';
        modal.removeAttribute('inert');
        $(focusElId, modal)?.focus();
    }
    appStore.set(s => ({ ...s, ui: { ...s.ui, modalOpen: id } }));
};

export const hideModal = id => {
    const modal = $(`#${id}`);
    if (modal) {
        modal.style.display = 'none';
        modal.setAttribute('inert', '');
    }
    appStore.set(s => ({ ...s.ui, modalOpen: null }));
};
