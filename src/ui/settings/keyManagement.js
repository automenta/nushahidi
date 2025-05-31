import {nip19} from 'nostr-tools';
import {appStore} from '../../store.js';
import {idSvc} from '../../services.js';
import {showToast, createEl} from '../../utils.js';
import {withLoading, withToast} from '../../decorators.js';
import {renderForm} from '../forms.js';
import {showPassphraseModal} from '../modals.js';

export class KeyManagementSection {
    constructor() {
        this.sectionEl = createEl('section');
        this.sectionEl.appendChild(createEl('h3', {textContent: 'Key Management'}));
        this.form = null;
        this.exportSkBtn = null;
        this.oldPassInput = null;
        this.newPassInput = null;
        this.changePassBtn = null;

        this.render(appStore.get());

        this.unsubscribe = appStore.on((newState, oldState) => {
            if (newState.user?.authM !== oldState?.user?.authM) {
                this.render(newState);
            }
        });
    }

    render(appState) {
        const keyManagementFormFields = [
            {type: 'button', ref: 'exportSkBtn', label: 'Export Private Key'},
            {label: 'Old Passphrase:', type: 'password', name: 'oldPassphrase'},
            {label: 'New Passphrase:', type: 'password', name: 'newPassphrase'},
            {type: 'button', ref: 'changePassBtn', label: 'Change Passphrase'}
        ];

        const {form, fields} = renderForm(keyManagementFormFields, {}, {class: 'key-management-form'});

        if (!this.form) {
            this.form = form;
            this.sectionEl.appendChild(this.form);
        } else {
            this.form.replaceWith(form);
            this.form = form;
        }

        this.exportSkBtn = fields.exportSkBtn;
        this.oldPassInput = fields.oldPassphrase;
        this.newPassInput = fields.newPassphrase;
        this.changePassBtn = fields.changePassBtn;

        this.exportSkBtn.onclick = withLoading(withToast(async () => {
            const user = appStore.get().user;
            if (!user) throw new Error("No Nostr identity connected.");
            if (user.authM === 'nip07') throw new Error("NIP-07 keys cannot be exported.");

            const sk = await showPassphraseModal("Decrypt Private Key", "Enter your passphrase to decrypt and export your private key.");
            if (!sk) {
                showToast("Export cancelled.", 'info');
                return null;
            }
            const decryptedSk = await idSvc.getSk(false, sk);
            if (!decryptedSk) throw new Error("Private key not available for export.");
            showToast(
                "Your private key (nsec) is displayed below. Copy it NOW and store it securely. DO NOT share it.",
                'critical-warning',
                0,
                nip19.nsecEncode(decryptedSk)
            );
        }, null, "Export failed"));

        this.changePassBtn.onclick = withLoading(withToast(async () => {
            const oldPass = this.oldPassInput.value;
            const newPass = this.newPassInput.value;
            if (!oldPass || !newPass || newPass.length < 8) throw new Error("Both passphrases are required, new must be min 8 chars.");
            await idSvc.chgPass(oldPass, newPass);
            this.oldPassInput.value = '';
            this.newPassInput.value = '';
        }, null, "Passphrase change failed"));

        if (!appState.user || !['local', 'import'].includes(appState.user.authM)) {
            this.sectionEl.style.display = 'none';
        } else {
            this.sectionEl.style.display = '';
        }
        return this.sectionEl;
    }

    get element() {
        return this.sectionEl;
    }
}
