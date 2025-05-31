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

        const contentRenderer = () => {
            const authFormFields = [
                {type: 'paragraph', content: [createEl('strong', {textContent: 'Recommended: '}), 'Use NIP-07 (Alby, etc.)']},
                {type: 'button', ref: 'connectNip07Btn', label: 'Connect NIP-07'},
                {type: 'hr'},
                {type: 'h4', content: ['Local Keys (Advanced/Risky)']},
                {type: 'custom-html', class: 'critical-warning', innerHTML: '<p><strong>SECURITY WARNING:</strong> Storing keys in browser is risky. Backup private key (nsec)!</p>'},
                {label: 'Passphrase (min 8 chars):', type: 'password', name: 'authPassphrase', autocomplete: 'new-password'},
                {type: 'button', ref: 'createProfileBtn', label: 'Create New Profile'},
                {type: 'hr'},
                {label: 'Import Private Key (nsec/hex):', type: 'text', name: 'authPrivateKey'},
                {type: 'button', ref: 'importKeyBtn', label: 'Import Key'},
                {type: 'button', ref: 'cancelAuthModalBtn', class: 'secondary', label: 'Cancel', onclick: () => this.hide(), style: 'margin-top:1rem'}
            ];

            const {form, fields} = renderForm(authFormFields, {}, {class: 'auth-form'});

            connNip07Btn = fields.connectNip07Btn;
            authPassInput = fields.authPassphrase;
            createProfBtn = fields.createProfileBtn;
            authSkInput = fields.authPrivateKey;
            importSkBtn = fields.importKeyBtn;
            cancelAuthModalBtn = fields.cancelAuthModalBtn;

            connNip07Btn.onclick = this.handleConnectNip07;
            createProfBtn.onclick = this._handleAuthAction(
                "Backup Private Key?",
                "<strong>CRITICAL:</strong> You are about to create a new Nostr identity. Your private key (nsec) will be generated and displayed. You MUST copy and securely back it up. If you lose it, your identity and associated data will be unrecoverable. Do you understand and wish to proceed?",
                async () => {
                    const passphrase = authPassInput.value;
                    if (!passphrase || passphrase.length < 8) throw new Error("Passphrase too short (min 8 chars).");
                    if (!await idSvc.newProf(passphrase)) throw new Error("Profile creation failed.");
                    this.hide();
                },
                "New profile creation cancelled.",
                "Error creating profile"
            );
            importSkBtn.onclick = this._handleAuthAction(
                "Import Private Key?",
                "<strong>HIGH RISK:</strong> Importing a private key directly into the browser is generally discouraged due to security risks. Ensure you understand the implications. It is highly recommended to use a NIP-07 browser extension instead. Do you wish to proceed?",
                async () => {
                    const privateKey = authSkInput.value;
                    const passphrase = authPassInput.value;
                    if (!privateKey || !passphrase || passphrase.length < 8) throw new Error("Private key and passphrase (min 8 chars) are required.");
                    if (!await idSvc.impSk(privateKey, passphrase)) throw new Error("Private key import failed.");
                    this.hide();
                },
                "Private key import cancelled.",
                "Error importing key"
            );
            cancelAuthModalBtn.onclick = () => this.hide();

            return form;
        };
        super('auth-modal', 'Nostr Identity', contentRenderer);
    }

    handleConnectNip07 = withLoading(async () => {
        if (!await idSvc.nip07()) throw new Error("NIP-07 connection failed or user not found.");
        this.hide();
    });

    _handleAuthAction = (confirmTitle, confirmMessage, actionFn, cancelMsg, errorMsg) => withToast(async () => {
        const confirmed = await showConfirmModal(confirmTitle, confirmMessage);
        if (!confirmed) {
            showToast(cancelMsg, 'info');
            return;
        }
        await withLoading(actionFn)();
    }, null, errorMsg);
}
