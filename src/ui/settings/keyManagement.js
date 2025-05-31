import {nip19} from 'nostr-tools';
import {appStore} from '../../store.js';
import {idSvc} from '../../services.js';
import {showToast} from '../../utils.js';
import {withLoading, withToast} from '../../decorators.js';
import {renderForm} from '../forms.js';
import {showPassphraseModal} from '../modals.js';

export const KeyManagementSection = () => {
    let sectionEl;
    let form;
    let exportSkBtn;
    let oldPassInput;
    let newPassInput;
    let changePassBtn;

    const render = (appState) => {
        if (!sectionEl) {
            sectionEl = createEl('section');
            const keyManagementFormFields = [
                { type: 'button', id: 'exp-sk-btn', label: 'Export Private Key' },
                { label: 'Old Passphrase:', type: 'password', id: 'chg-pass-old', name: 'oldPassphrase' },
                { label: 'New Passphrase:', type: 'password', id: 'chg-pass-new', name: 'newPassphrase' },
                { type: 'button', id: 'chg-pass-btn', label: 'Change Passphrase' }
            ];

            form = renderForm(keyManagementFormFields, {}, { id: 'key-management-form' });
            sectionEl.appendChild(form);

            exportSkBtn = form.querySelector('#exp-sk-btn');
            oldPassInput = form.querySelector('#chg-pass-old');
            newPassInput = form.querySelector('#chg-pass-new');
            changePassBtn = form.querySelector('#chg-pass-btn');

            exportSkBtn.onclick = withLoading(withToast(async () => {
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

            changePassBtn.onclick = withLoading(withToast(async () => {
                const oldPass = oldPassInput.value;
                const newPass = newPassInput.value;
                if (!oldPass || !newPass || newPass.length < 8) throw new Error("Both passphrases are required, new must be min 8 chars.");
                await idSvc.chgPass(oldPass, newPass);
                oldPassInput.value = '';
                newPassInput.value = '';
            }, null, "Passphrase change failed"));
        }

        if (!appState.user || !['local', 'import'].includes(appState.user.authM)) {
            sectionEl.style.display = 'none';
        } else {
            sectionEl.style.display = '';
        }
        return sectionEl;
    };

    appStore.on((newState, oldState) => {
        if (newState.user?.authM !== oldState?.user?.authM) {
            render(newState);
        }
    });

    return render(appStore.get());
};
