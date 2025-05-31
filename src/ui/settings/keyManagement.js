import { nip19 } from 'nostr-tools';
import { appStore } from '../../store.js';
import { idSvc } from '../../services.js';
import { $, showToast } from '../../utils.js';
import { withLoading, withToast } from '../../decorators.js';
import { renderForm } from '../forms.js';

/**
 * Renders the key management section form.
 * @param {HTMLElement} modalContent The parent modal content element.
 * @returns {HTMLElement} The rendered form element.
 */
export const renderKeyManagementSection = (modalContent) => {
    const appState = appStore.get();
    if (!appState.user || (appState.user.authM !== 'local' && appState.user.authM !== 'import')) {
        return null; // Only show if local/imported key is used
    }

    const keyManagementFormFields = [
        { type: 'button', id: 'exp-sk-btn', label: 'Export Private Key' },
        { label: 'Old Passphrase:', type: 'password', id: 'chg-pass-old', name: 'oldPassphrase' },
        { label: 'New Passphrase:', type: 'password', id: 'chg-pass-new', name: 'newPassphrase' },
        { type: 'button', id: 'chg-pass-btn', label: 'Change Passphrase' }
    ];

    const form = renderForm(keyManagementFormFields, {}, { id: 'key-management-form' });
    modalContent.appendChild(form); // Append to modalContent directly

    setupKeyManagementListeners(form);
    return form;
};

/**
 * Sets up event listeners for the key management section.
 * @param {HTMLElement} formRoot The root element of the key management form.
 */
const setupKeyManagementListeners = (formRoot) => {
    const expSkBtn = $('#exp-sk-btn', formRoot);
    if (expSkBtn) {
        expSkBtn.onclick = withLoading(withToast(async () => {
            if (!appStore.get().user) throw new Error("No Nostr identity connected.");
            if (appStore.get().user.authM === 'nip07') throw new Error("NIP-07 keys cannot be exported.");

            const sk = await idSvc.getSk(true);
            if (sk) {
                showToast(
                    "Your private key (nsec) is displayed below. Copy it NOW and store it securely. DO NOT share it.",
                    'critical-warning',
                    0,
                    nip19.nsecEncode(sk)
                );
            } else {
                throw new Error("Private key not available for export.");
            }
        }, null, "Export failed"));
    }

    const chgPassBtn = $('#chg-pass-btn', formRoot);
    if (chgPassBtn) {
        chgPassBtn.onclick = withLoading(withToast(async () => {
            const oldPass = $('#chg-pass-old', formRoot).value;
            const newPass = $('#chg-pass-new', formRoot).value;
            if (!oldPass || !newPass || newPass.length < 8) {
                throw new Error("Both passphrases are required, new must be min 8 chars.");
            }
            await idSvc.chgPass(oldPass, newPass);
            $('#chg-pass-old', formRoot).value = '';
            $('#chg-pass-new', formRoot).value = '';
        }, null, "Passphrase change failed"));
    }
};
