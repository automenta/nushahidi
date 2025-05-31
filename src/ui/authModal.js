import { nip19 } from 'nostr-tools';
import { appStore } from '../store.js';
import { idSvc } from '../services.js';
import { C, $, createEl, showToast } from '../utils.js';
import { createModalWrapper, showConfirmModal, hideModal } from './modals.js';
import { renderForm } from './forms.js';

export function AuthModalComp() {
    const authFormFields = [
        { type: 'paragraph', content: [createEl('strong', { textContent: 'Recommended: ' }), 'Use NIP-07 (Alby, etc.)'] },
        { type: 'button', id: 'conn-nip07-btn', label: 'Connect NIP-07' },
        { type: 'hr' },
        { type: 'paragraph', content: [createEl('h4', { textContent: 'Local Keys (Advanced/Risky)' })] },
        { type: 'custom-html', class: 'critical-warning', innerHTML: '<p><strong>SECURITY WARNING:</strong> Storing keys in browser is risky. Backup private key (nsec)!</p>' },
        { label: 'Passphrase (min 8 chars):', type: 'password', id: 'auth-pass', autocomplete: 'new-password' },
        { type: 'button', id: 'create-prof-btn', label: 'Create New Profile' },
        { type: 'hr' },
        { label: 'Import Private Key (nsec/hex):', type: 'text', id: 'auth-sk' },
        { type: 'button', id: 'import-sk-btn', label: 'Import Key' },
        { type: 'button', class: 'secondary', label: 'Cancel', onclick: () => hideModal('auth-modal'), style: 'margin-top:1rem' }
    ];

    const modalContent = createModalWrapper('auth-modal', 'Nostr Identity', (root) => {
        const form = renderForm(authFormFields, {}, { id: 'auth-form' });
        root.appendChild(form); // Append the form to the modal content root

        // Attach event listeners to the elements *after* they are rendered by renderForm
        $('#conn-nip07-btn', form).onclick = async () => { // Scope to form
            appStore.set(s => ({ ui: { ...s.ui, loading: true } }));
            try {
                await idSvc.nip07();
                if (appStore.get().user) hideModal('auth-modal');
            } finally {
                appStore.set(s => ({ ui: { ...s.ui, loading: false } }));
            }
        };

        $('#create-prof-btn', form).onclick = async () => { // Scope to form
            const passphrase = $('#auth-pass', form).value;
            if (!passphrase || passphrase.length < 8) {
                showToast("Passphrase too short (min 8 chars).", 'warning');
                return;
            }
            showConfirmModal(
                "Backup Private Key?",
                "<strong>CRITICAL:</strong> You are about to create a new Nostr identity. Your private key (nsec) will be generated and displayed. You MUST copy and securely back it up. If you lose it, your identity and associated data will be unrecoverable. Do you understand and wish to proceed?",
                async () => {
                    appStore.set(s => ({ ui: { ...s.ui, loading: true } }));
                    try {
                        const result = await idSvc.newProf(passphrase);
                        if (result) hideModal('auth-modal');
                    } finally {
                        appStore.set(s => ({ ui: { ...s.ui, loading: false } }));
                    }
                },
                () => showToast("New profile creation cancelled.", 'info')
            );
        };

        $('#import-sk-btn', form).onclick = async () => { // Scope to form
            const privateKey = $('#auth-sk', form).value;
            const passphrase = $('#auth-pass', form).value;
            if (!privateKey || !passphrase || passphrase.length < 8) {
                showToast("Private key and passphrase (min 8 chars) are required.", 'warning');
                return;
            }
            showConfirmModal(
                "Import Private Key?",
                "<strong>HIGH RISK:</strong> Importing a private key directly into the browser is generally discouraged due to security risks. Ensure you understand the implications. It is highly recommended to use a NIP-07 browser extension instead. Do you wish to proceed?",
                async () => {
                    appStore.set(s => ({ ui: { ...s.ui, loading: true } }));
                    try {
                        const result = await idSvc.impSk(privateKey, passphrase);
                        if (result) hideModal('auth-modal');
                    } finally {
                        appStore.set(s => ({ ui: { ...s.ui, loading: false } }));
                    }
                },
                (() => showToast("Private key import cancelled.", 'info'))
            );
        };
        return form; // Return the form element
    });
    return modalContent;
}
