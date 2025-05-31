import {appStore} from '../store.js';
import {$, createEl} from '../utils.js';

export function createModalWrapper(modalId, title, contentRenderer) {
    const modalElement = $(`#${modalId}`);
    if (!modalElement) {
        console.error(`Modal element with ID ${modalId} not found.`);
        return null;
    }

    const modalContent = createEl('div', { class: 'modal-content' });
    modalElement.innerHTML = '';
    modalElement.appendChild(modalContent);

    const closeBtn = createEl('span', { class: 'close-btn', innerHTML: '&times;', onclick: () => hideModal(modalId) });
    const heading = createEl('h2', { id: `${modalId}-heading`, textContent: title });

    modalContent.appendChild(closeBtn);
    modalContent.appendChild(heading);

    const specificContent = contentRenderer(modalContent);
    if (Array.isArray(specificContent)) {
        specificContent.forEach(el => modalContent.appendChild(el));
    } else if (specificContent instanceof Node) {
        modalContent.appendChild(specificContent);
    }

    return modalContent;
}

export function showConfirmModal(title, message, onConfirm, onCancel) {
    createModalWrapper('confirm-modal', title, root => {
        const msgPara = createEl('p', { innerHTML: message });
        const buttonContainer = createEl('div', { class: 'confirm-modal-buttons' });

        const confirmBtn = createEl('button', {
            class: 'confirm-button',
            textContent: 'Confirm',
            onclick: () => { hideModal('confirm-modal'); onConfirm(); }
        });
        const cancelBtn = createEl('button', {
            class: 'cancel-button',
            textContent: 'Cancel',
            onclick: () => { hideModal('confirm-modal'); if (onCancel) onCancel(); }
        });

        buttonContainer.appendChild(cancelBtn);
        buttonContainer.appendChild(confirmBtn);

        return [msgPara, buttonContainer];
    });

    showModal('confirm-modal', 'confirm-modal-heading');
}

export function showPassphraseModal(title, message) {
    return new Promise(resolve => {
        createModalWrapper('passphrase-modal', title, root => {
            const msgPara = createEl('p', { textContent: message });
            const passphraseInput = createEl('input', { type: 'password', id: 'passphrase-input', placeholder: 'Enter passphrase', autocomplete: 'current-password' });
            const buttonContainer = createEl('div', { class: 'confirm-modal-buttons' });

            const decryptBtn = createEl('button', {
                class: 'confirm-button',
                textContent: 'Decrypt',
                onclick: () => {
                    const passphrase = passphraseInput.value;
                    hideModal('passphrase-modal');
                    resolve(passphrase);
                }
            });
            const cancelBtn = createEl('button', {
                class: 'cancel-button',
                textContent: 'Cancel',
                onclick: () => { hideModal('passphrase-modal'); resolve(null); }
            });

            passphraseInput.addEventListener('keydown', e => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    decryptBtn.click();
                }
            });

            buttonContainer.appendChild(cancelBtn);
            buttonContainer.appendChild(decryptBtn);

            return [msgPara, passphraseInput, buttonContainer];
        });

        showModal('passphrase-modal', 'passphrase-input');
    });
}

export const showModal = (id, focusElId) => {
    const modal = $(`#${id}`);
    if (modal) {
        modal.style.display = 'block';
        modal.setAttribute('aria-hidden', 'false');
        if (focusElId) $(focusElId, modal)?.focus();
    }
    appStore.set(s => ({ ...s, ui: { ...s.ui, modalOpen: id } }));
};

export const hideModal = id => {
    const modal = $(`#${id}`);
    if (modal) {
        modal.style.display = 'none';
        modal.setAttribute('aria-hidden', 'true');
    }
    appStore.set(s => ({ ...s.ui, modalOpen: null }));
};
