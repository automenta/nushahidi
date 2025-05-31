import {nip19} from 'nostr-tools';
import {appStore} from '../../store.js';
import {idSvc} from '../../services.js';
import {$, showToast} from '../../utils.js';
import {withLoading, withToast} from '../../decorators.js';
import {renderForm} from '../forms.js';

export const renderKeyManagementSection = modalContent => {
    const appState = appStore.get();
    if (!appState.user || !['local', 'import'].includes(appState.user.authM)) return null;

    const keyManagementFormFields = [
        { type: 'button', id: 'exp-sk-btn', label: 'Export Private Key' },
        { label: 'Old Passphrase:', type: 'password', id: 'chg-pass-old', name: 'oldPassphrase' },
        { label: 'New Passphrase:', type: 'password', id: 'chg-pass-new', name: 'newPassphrase' },
        { type: 'button', id: 'chg-pass-btn', label: 'Change Passphrase' }
    ];

    const form = renderForm(keyManagementFormFields, {}, { id: 'key-management-form' });
    modalContent.appendChild(form);

    $('#exp-sk-btn', form).onclick = withLoading(withToast(async () => {
        const user = appStore.get().user;
        if (!user) throw new Error("No Nostr identity connected.");
        if (user.authM === 'nip07') throw new Error("NIP-07 keys cannot be exported.");

        const sk = await idSvc.getSk(true);
        if (!sk) throw new Error("Private key not available for export.");
        showToast(
            "Your private key (nsec) is displayed below. Copy it NOW and store it securely. DO NOT share it.",
            'critical-warning',
            0,
            nip19.nsecEncode(sk)
        );
    }, null, "Export failed"));

    $('#chg-pass-btn', form).onclick = withLoading(withToast(async () => {
        const oldPass = $('#chg-pass-old', form).value;
        const newPass = $('#chg-pass-new', form).value;
        if (!oldPass || !newPass || newPass.length < 8) throw new Error("Both passphrases are required, new must be min 8 chars.");
        await idSvc.chgPass(oldPass, newPass);
        $('#chg-pass-old', form).value = '';
        $('#chg-pass-new', form).value = '';
    }, null, "Passphrase change failed"));

    return form;
};
