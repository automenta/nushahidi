import {appStore} from '../../store.js';
import {idSvc} from '../../services.js';
import {createEl, showToast} from '../../utils.js';
import {Modal, showConfirmModal} from '../modals.js';
import {renderForm} from '../forms.js';
import {withLoading, withToast} from '../../decorators.js';

export class AuthModal extends Modal {
    constructor() {
        let connNip07Btn;
        let authPassInput;
        let createProfBtn;
        let authSkInput;
        let importSkBtn;
        let cancelAuthModalBtn;

        const contentRenderer = (contentRoot, modalRoot) => {
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
                { type: 'button', id: 'cancel-auth-modal-btn', class: 'secondary', label: 'Cancel', onclick: () => this.hide(), style: 'margin-top:1rem' }
            ];

            const { form, fields } = renderForm(authFormFields, {}, {id: 'auth-form'});

            connNip07Btn = fields['conn-nip07-btn'];
            authPassInput = fields['auth-pass'];
            createProfBtn = fields['create-prof-btn'];
            authSkInput = fields['auth-sk'];
            importSkBtn = fields['import-sk-btn'];
            cancelAuthModalBtn = fields['cancel-auth-modal-btn'];

            connNip07Btn.onclick = this.handleConnectNip07;
            createProfBtn.onclick = withToast(() => this.handleCreateProfile(authPassInput.value), null, "Error creating profile");
            importSkBtn.onclick = withToast(() => this.handleImportKey(authSkInput.value, authPassInput.value), null, "Error importing key");
            cancelAuthModalBtn.onclick = () => this.hide();

            return form;
        };
        super('auth-modal', 'Nostr Identity', contentRenderer);
    }

    handleConnectNip07 = withLoading(async () => {
        await idSvc.nip07();
        if (!appStore.get().user) throw new Error("NIP-07 connection failed or user not found.");
        this.hide();
    });

    handleCreateProfile = async passphrase => {
        if (!passphrase || passphrase.length < 8) throw new Error("Passphrase too short (min 8 chars).");
        const confirmed = await showConfirmModal(
            "Backup Private Key?",
            "<strong>CRITICAL:</strong> You are about to create a new Nostr identity. Your private key (nsec) will be generated and displayed. You MUST copy and securely back it up. If you lose it, your identity and associated data will be unrecoverable. Do you understand and wish to proceed?"
        );
        if (!confirmed) {
            showToast("New profile creation cancelled.", 'info');
            return;
        }
        await withLoading(async () => {
            if (!await idSvc.newProf(passphrase)) throw new Error("Profile creation failed.");
            this.hide();
        })();
    };

    handleImportKey = async (privateKey, passphrase) => {
        if (!privateKey || !passphrase || passphrase.length < 8) throw new Error("Private key and passphrase (min 8 chars) are required.");
        const confirmed = await showConfirmModal(
            "Import Private Key?",
            "<strong>HIGH RISK:</strong> Importing a private key directly into the browser is generally discouraged due to security risks. Ensure you understand the implications. It is highly recommended to use a NIP-07 browser extension instead. Do you wish to proceed?"
        );
        if (!confirmed) {
            showToast("Private key import cancelled.", 'info');
            return;
        }
        await withLoading(async () => {
            if (!await idSvc.impSk(privateKey, passphrase)) throw new Error("Private key import failed.");
            this.hide();
        })();
    };
}
