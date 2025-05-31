import {appStore} from '../../store.js';
import {idSvc} from '../../services.js';
import {$, createEl, showToast} from '../../utils.js';
import {Modal, hideModal, showConfirmModal} from '../modals.js';
import {renderForm} from '../forms.js';
import {withLoading, withToast} from '../../decorators.js';

export function AuthModal() {
    const handleConnectNip07 = withLoading(async () => {
        await idSvc.nip07();
        if (!appStore.get().user) throw new Error("NIP-07 connection failed or user not found.");
        hideModal('auth-modal');
    });

    const handleCreateProfile = async passphrase => {
        if (!passphrase || passphrase.length < 8) throw new Error("Passphrase too short (min 8 chars).");
        showConfirmModal(
            "Backup Private Key?",
            "<strong>CRITICAL:</strong> You are about to create a new Nostr identity. Your private key (nsec) will be generated and displayed. You MUST copy and securely back it up. If you lose it, your identity and associated data will be unrecoverable. Do you understand and wish to proceed?",
            withLoading(async () => {
                if (!await idSvc.newProf(passphrase)) throw new Error("Profile creation failed.");
                hideModal('auth-modal');
            }),
            () => showToast("New profile creation cancelled.", 'info')
        );
    };

    const handleImportKey = async (privateKey, passphrase) => {
        if (!privateKey || !passphrase || passphrase.length < 8) throw new Error("Private key and passphrase (min 8 chars) are required.");
        showConfirmModal(
            "Import Private Key?",
            "<strong>HIGH RISK:</strong> Importing a private key directly into the browser is generally discouraged due to security risks. Ensure you understand the implications. It is highly recommended to use a NIP-07 browser extension instead. Do you wish to proceed?",
            withLoading(async () => {
                if (!await idSvc.impSk(privateKey, passphrase)) throw new Error("Private key import failed.");
                hideModal('auth-modal');
            }),
            () => showToast("Private key import cancelled.", 'info')
        );
    };

    const authFormFields = [
        { type: 'paragraph', content: [createEl('strong', { textContent: 'Recommended: ' }), 'Use NIP-07 (Alby, etc.)'] },
        { type: 'button', id: 'conn-nip07-btn', label: 'Connect NIP-07' },
        { type: 'hr' },
        { type: 'h4', content: ['Local Keys (Advanced/Risky)'] },
        { type: 'custom-html', class: 'critical-warning', innerHTML: '<p><strong>SECURITY WARNING:</strong> Storing keys in browser is risky. Backup private key (nsec)!</p>' },
        { label: 'Passphrase (min 8 chars):', type: 'password', id: 'auth-pass', autocomplete: 'new-password' },
        { type: 'button', id: 'create-prof-btn', label: 'Create New Profile' },
        { type: 'hr' },
        { label: 'Import Private Key (nsec/hex):', type: 'text', id: 'auth-sk' },
        { type: 'button', id: 'import-sk-btn', label: 'Import Key' },
        { type: 'button', id: 'cancel-auth-modal-btn', class: 'secondary', label: 'Cancel', onclick: () => hideModal('auth-modal'), style: 'margin-top:1rem' }
    ];

    // The Modal function now creates and appends the modal to document.body
    const modalElement = Modal('auth-modal', 'Nostr Identity', root => {
        const form = renderForm(authFormFields, {}, {id: 'auth-form'});
        root.appendChild(form);
        $('#conn-nip07-btn', form).onclick = handleConnectNip07;
        $('#create-prof-btn', form).onclick = withToast(() => handleCreateProfile($('#auth-pass', form).value), null, "Error creating profile");
        $('#import-sk-btn', form).onclick = withToast(() => handleImportKey($('#auth-sk', form).value, $('#auth-pass', form).value), null, "Error importing key");
        return form;
    });

    return modalElement;
}
