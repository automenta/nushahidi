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
        const modalElement = createEl('div', { id: this.modalId, class: `modal ${this.modalId}` });
        const modalContent = createEl('div', { class: 'modal-content' });

        modalElement.append(
            createEl('span', { class: 'close-btn', innerHTML: '&times;', onclick: () => this.hide() }),
            createEl('h2', { textContent: sanitizeHTML(this.title) }),
            modalContent
        );

        const contentToAppend = typeof this.contentRenderer === 'function' ? this.contentRenderer(modalContent, modalElement) : this.contentRenderer;
        const contentArray = Array.isArray(contentToAppend) ? contentToAppend : [contentToAppend];
        contentArray.filter(Boolean).forEach(el => modalContent.appendChild(el));

        return modalElement;
    }

    show(focusSelectorOrElement = null) {
        this.root.style.display = 'block';
        this.root.removeAttribute('inert');

        let focusEl = null;
        if (focusSelectorOrElement instanceof Element) {
            focusEl = focusSelectorOrElement;
        } else if (typeof focusSelectorOrElement === 'string') {
            focusEl = this.root.querySelector(focusSelectorOrElement);
        } else {
            focusEl = this.root.querySelector('h2') || this.root.querySelector('button, input, select, textarea');
        }
        focusEl?.focus();

        appStore.set(s => ({ ...s, ui: { ...s.ui, modalOpen: this.root } }));
    }

    hide() {
        this.root.style.display = 'none';
        this.root.setAttribute('inert', '');
        appStore.set(s => ({ ...s.ui, modalOpen: null }));
        this.root.remove();
    }
}

export const showConfirmModal = (title, message, onConfirm, onCancel) => {
    return new Promise(resolve => {
        let confirmModal;
        const contentRenderer = () => {
            const cancelBtn = createEl('button', { class: 'cancel-button', textContent: 'Cancel' });
            const confirmBtn = createEl('button', { class: 'confirm-button', textContent: 'Confirm' });

            cancelBtn.onclick = () => { confirmModal.hide(); onCancel?.(); resolve(false); };
            confirmBtn.onclick = () => { confirmModal.hide(); onConfirm(); resolve(true); };

            return [
                createEl('p', { innerHTML: sanitizeHTML(message) }),
                createEl('div', { class: 'confirm-modal-buttons' }, [cancelBtn, confirmBtn])
            ];
        };
        confirmModal = new Modal('confirm-modal', title, contentRenderer);
        confirmModal.show('h2');
    });
};

export const showPassphraseModal = (title, message) => {
    return new Promise(resolve => {
        let passphraseInput;
        let decryptBtn;
        let cancelBtn;
        let passphraseModal;

        const contentRenderer = () => {
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
        };
        passphraseModal = new Modal('passphrase-modal', title, contentRenderer);
        passphraseModal.show('#passphrase-input');
    });
};
