import {nip19} from 'nostr-tools';
import {appStore} from '../../store.js';
import {idSvc} from '../../services.js';
import {createEl, showToast} from '../../utils.js';
import {withLoading, withToast} from '../../decorators.js';
import {renderForm} from '../forms.js';
import {showPassphraseModal} from '../modals.js';

export class KeyManagementSection {
    constructor() {
        this.sectionEl = createEl('section');
        this.sectionEl.appendChild(createEl('h3', {textContent: 'Key Management'}));
        this.form = null;
        this.formFields = {}; // Store references to form fields for granular updates

        this.createFormElements(appStore.get()); // Initial creation of form elements
        this.sectionEl.appendChild(this.form);

        this.unsubscribe = appStore.on((newState, oldState) => {
            if (newState.user?.authM !== oldState?.user?.authM) {
                this.updateFormElements(newState); // Granular update
            }
        });
    }

    createFormElements(appState) {
        const keyManagementFormFieldsConfig = [
            {type: 'button', ref: 'exportSkBtn', label: 'Export Private Key'},
            {label: 'Old Passphrase:', type: 'password', ref: 'oldPassphraseInput', name: 'oldPassphrase'},
            {label: 'New Passphrase:', type: 'password', ref: 'newPassphraseInput', name: 'newPassphrase'},
            {type: 'button', ref: 'changePassBtn', label: 'Change Passphrase'}
        ];

        const {form, fields} = renderForm(keyManagementFormFieldsConfig, {}, {class: 'key-management-form'});
        this.form = form;
        this.formFields = fields;

        this.formFields.exportSkBtn.onclick = withLoading(withToast(async () => {
            const user = appStore.get().user;
            if (!user) throw new Error("No Nostr identity connected.");
            if (user.authM === 'nip07') throw new Error("NIP-07 keys cannot be exported.");

            const passphrase = await showPassphraseModal("Decrypt Private Key", "Enter your passphrase to decrypt and export your private key.");
            if (!passphrase) {
                showToast("Export cancelled.", 'info');
                return null;
            }
            const decryptedSk = await idSvc.getSk(false, passphrase);
            if (!decryptedSk) throw new Error("Private key not available for export.");
            showToast(
                "Your private key (nsec) is displayed below. Copy it NOW and store it securely. DO NOT share it.",
                'critical-warning',
                0,
                nip19.nsecEncode(decryptedSk)
            );
        }, null, "Export failed"));

        this.formFields.changePassBtn.onclick = withLoading(withToast(async () => {
            const oldPass = this.formFields.oldPassphraseInput.value;
            const newPass = this.formFields.newPassphraseInput.value;
            if (!oldPass || !newPass || newPass.length < 8) throw new Error("Both passphrases are required, new must be min 8 chars.");
            await idSvc.chgPass(oldPass, newPass);
            this.formFields.oldPassphraseInput.value = '';
            this.formFields.newPassphraseInput.value = '';
        }, null, "Passphrase change failed"));

        this.updateFormElements(appState); // Set initial display based on appState
    }

    updateFormElements(appState) {
        if (!appState.user || !['local', 'import'].includes(appState.user.authM)) {
            this.sectionEl.style.display = 'none';
        } else {
            this.sectionEl.style.display = '';
        }
        // Clear password fields on update, as they are sensitive
        this.formFields.oldPassphraseInput.value = '';
        this.formFields.newPassphraseInput.value = '';
    }

    get element() {
        return this.sectionEl;
    }
}
