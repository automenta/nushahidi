import {appStore} from '../store.js';
import {createEl, sanitizeHTML} from '../utils.js';

export class Modal {
    constructor(modalId, title, contentRenderer) {
        this.modalId = modalId;
        this.title = title;
        this.contentRenderer = contentRenderer;
        this.root = this.createModalElement();
        document.body.appendChild(this.root);
    }

    createModalElement() {
        const existingModal = document.getElementById(this.modalId);
        if (existingModal) existingModal.remove();

        const modalElement = createEl('div', { id: this.modalId, class: 'modal', inert: '' });
        const modalContent = createEl('div', { class: 'modal-content' });

        modalElement.append(
            createEl('span', { class: 'close-btn', innerHTML: '&times;', onclick: () => this.hide() }),
            createEl('h2', { id: `${this.modalId}-heading`, textContent: sanitizeHTML(this.title) }),
            modalContent
        );

        const contentToAppend = typeof this.contentRenderer === 'function' ? this.contentRenderer(modalContent, modalElement) : this.contentRenderer;
        const contentArray = Array.isArray(contentToAppend) ? contentToAppend : [contentToAppend];
        contentArray.filter(Boolean).forEach(el => modalContent.appendChild(el));

        return modalElement;
    }

    show(focusElOrSelector) {
        this.root.style.display = 'block';
        this.root.removeAttribute('inert');

        let focusEl = null;
        if (focusElOrSelector instanceof Element) focusEl = focusElOrSelector;
        else if (typeof focusElOrSelector === 'string') focusEl = this.root.querySelector(focusElOrSelector);
        focusEl?.focus();

        appStore.set(s => ({ ...s, ui: { ...s.ui, modalOpen: this.root } }));
    }

    hide() {
        this.root.style.display = 'none';
        this.root.setAttribute('inert', '');
        appStore.set(s => ({ ...s.ui, modalOpen: null }));
    }
}

export const showModal = (modalInstance, focusElOrSelector) => {
    if (modalInstance instanceof Modal) {
        modalInstance.show(focusElOrSelector);
    } else {
        console.error("Invalid modal instance provided to showModal.");
    }
};

export const hideModal = modalInstance => {
    if (modalInstance instanceof Modal) {
        modalInstance.hide();
    } else {
        console.error("Invalid modal instance provided to hideModal.");
    }
};

export const showConfirmModal = (title, message, onConfirm, onCancel) => {
    const confirmModal = new Modal('confirm-modal', title, (contentRoot) => {
        const cancelBtn = createEl('button', { class: 'cancel-button', textContent: 'Cancel' });
        const confirmBtn = createEl('button', { class: 'confirm-button', textContent: 'Confirm' });

        cancelBtn.onclick = () => { confirmModal.hide(); onCancel?.(); };
        confirmBtn.onclick = () => { confirmModal.hide(); onConfirm(); };

        return [
            createEl('p', { innerHTML: sanitizeHTML(message) }),
            createEl('div', { class: 'confirm-modal-buttons' }, [cancelBtn, confirmBtn])
        ];
    });
    confirmModal.show(confirmModal.root.querySelector(`#${confirmModal.modalId}-heading`));
};

export const showPassphraseModal = (title, message) => {
    return new Promise(resolve => {
        let passphraseInput;
        let decryptBtn;
        let cancelBtn;

        const passphraseModal = new Modal('passphrase-modal', title, (contentRoot) => {
            passphraseInput = createEl('input', { type: 'password', id: 'passphrase-input', placeholder: 'Enter passphrase', autocomplete: 'current-password' });
            decryptBtn = createEl('button', { class: 'confirm-button', textContent: 'Decrypt' });
            cancelBtn = createEl('button', { class: 'cancel-button', textContent: 'Cancel' });

            decryptBtn.onclick = () => { passphraseModal.hide(); resolve(passphraseInput.value); };
            cancelBtn.onclick = () => { passphraseModal.hide(); resolve(null); };
            passphraseInput.addEventListener('keydown', e => e.key === 'Enter' && (e.preventDefault(), decryptBtn.click()));

            return [
                createEl('p', { textContent: message }),
                passphraseInput,
                createEl('div', { class: 'confirm-modal-buttons' }, [cancelBtn, decryptBtn])
            ];
        });
        passphraseModal.show(passphraseInput);
    });
};
