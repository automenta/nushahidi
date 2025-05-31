import { SimplePool, signEvent as signEvNostr } from 'nostr-tools';
import { generatePrivateKey, getPublicKey } from 'nostr-tools/keys';
import { encrypt, decrypt, nsecToHex, npubToHex, showToast } from '../utils.js';
import { appStore } from '../store.js';
import { confSvc } from './config.js';
import { withLoading, withToast } from '../decorators.js';
import { showPassphraseModal } from '../ui/modals.js';
import { nip19 } from 'nostr-tools';

let _locSk = null;

const _setLocalIdentity = async (sk, authMethod, passphrase) => {
    const pk = getPublicKey(sk);
    const eSk = await encrypt(sk, passphrase);
    const identity = { pk, eSk, authM: authMethod };
    appStore.set({ user: identity });
    confSvc.setId(identity);
    _locSk = sk;
    return identity;
};

export const idSvc = {
    async init() {
        const identity = await confSvc.getId();
        appStore.set({ user: identity });
    },

    nip07: withLoading(withToast(async () => {
        if (!window.nostr?.getPublicKey) {
            showToast("NIP-07 extension not found. Please install Alby or nos2x.", 'warning');
            return null;
        }
        const pubkey = await window.nostr.getPublicKey();
        if (!pubkey) return null;

        const identity = { pk: pubkey, authM: 'nip07' };
        appStore.set({ user: identity });
        confSvc.setId(identity);
        showToast("NIP-07 connected!", 'success');
        return identity;
    }, null, "NIP-07 connection failed")),

    async newProf(passphrase) {
        const sk = generatePrivateKey();
        const identity = await _setLocalIdentity(sk, 'local', passphrase);
        showToast("New profile created! Your private key (nsec) is displayed below. Copy it NOW and store it securely. DO NOT share it.", 'critical-warning', 0, nip19.nsecEncode(sk));
        return identity;
    },

    async impSk(privateKey, passphrase) {
        const sk = nsecToHex(privateKey);
        const identity = await _setLocalIdentity(sk, 'import', passphrase);
        showToast("Private key imported successfully!", 'success');
        return identity;
    },

    async getSk(promptPassphrase = true, passphrase = null) {
        const user = appStore.get().user;
        if (!user || user.authM === 'nip07') return null;
        if (_locSk) return _locSk;

        const identity = await confSvc.getId();
        if (!identity?.eSk) return null;

        let currentPassphrase = passphrase;
        if (!currentPassphrase && promptPassphrase) {
            currentPassphrase = await showPassphraseModal("Decrypt Private Key", "Enter your passphrase to decrypt your private key.");
        }
        if (!currentPassphrase) return null;

        try {
            _locSk = await decrypt(identity.eSk, currentPassphrase);
            showToast("Private key decrypted.", 'info');
            return _locSk;
        } catch (e) {
            showToast("Incorrect passphrase.", 'error');
            return null;
        }
    },

    async chgPass(oldPassphrase, newPassphrase) {
        const user = appStore.get().user;
        if (!user || user.authM === 'nip07') throw new Error("Cannot change passphrase for NIP-07 identity.");
        const sk = await this.getSk(false, oldPassphrase);
        if (!sk) throw new Error("Incorrect old passphrase or private key not available.");
        const eSk = await encrypt(sk, newPassphrase);
        await confSvc.setId({ ...user, eSk });
        showToast("Passphrase changed successfully!", 'success');
    },

    logout() {
        _locSk = null;
        confSvc.clearId();
        appStore.set({ user: null });
        showToast("Logged out successfully.", 'info');
    },

    async signEv(event) {
        const user = appStore.get().user;
        if (!user) throw new Error("No Nostr identity connected. Please connect or create one.");
        return user.authM === 'nip07' ? this.signEventNip07(event) : this.signEventLocal(event);
    },

    async signEventNip07(event) {
        if (!window.nostr?.signEvent) throw new Error("NIP-07 extension not found or not enabled.");
        try {
            return await window.nostr.signEvent(event);
        } catch (e) {
            throw new Error("NIP-07 signing failed: " + e.message);
        }
    },

    async signEventLocal(eventTemplate) {
        const sk = await idSvc.getSk(true);
        if (!sk) throw new Error("Private key not available for signing. Passphrase might be needed.");
        return signEvNostr(eventTemplate, sk);
    }
};
