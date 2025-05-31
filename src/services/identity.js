import {
    generateSecretKey as genSk,
    getPublicKey as getPk,
    finalizeEvent as signEvNostr
} from 'nostr-tools/pure';
import { nip19 } from 'nostr-tools';
import {appStore} from '../store.js';
import {decrypt, encrypt, isNostrId, nsecToHex, showToast} from '../utils.js';
import {showPassphraseModal} from '../ui/modals.js';
import {withLoading, withToast} from '../decorators.js';
import {confSvc} from './config.js';

let _locSk = null;

export const idSvc = {
    async init() {
        const id = await confSvc.getId();
        if (id) appStore.set({ user: { pk: id.pk, authM: id.authM } });
    },

    nip07: withLoading(withToast(async () => {
        if (!window.nostr?.getPublicKey) {
            showToast("NIP-07 extension not found. Please install Alby or nos2x.", 'warning');
            return null;
        }
        const pubkey = await window.nostr.getPublicKey();
        if (!pubkey) return null;

        const identity = { pk: pubkey, authM: 'nip07' };
        await confSvc.saveId(identity);
        appStore.set({ user: identity });
        return pubkey;
    }, "NIP-07 connected successfully!", "NIP-07 connection error")),

    newProf: withLoading(withToast(async passphrase => {
        if (!passphrase || passphrase.length < 8) {
            showToast("Passphrase too short (min 8 chars).", 'warning');
            return null;
        }
        const sk = genSk();
        const pk = getPk(sk);
        const encryptedSk = await encrypt(sk, passphrase);
        const identity = { pk, authM: 'local', eSk: encryptedSk };
        await confSvc.saveId(identity);
        appStore.set({ user: { pk, authM: 'local' } });
        _locSk = sk;
        showToast(`Profile created! Pubkey: ${nip19.npubEncode(pk)}.`, 'success');
        showToast(
            `CRITICAL: Backup your private key (nsec)!`,
            'warning',
            0,
            nip19.nsecEncode(sk)
        );
        return { pk, sk };
    }, null, "Profile creation error")),

    impSk: withLoading(withToast(async (skInput, passphrase) => {
        if (!passphrase || passphrase.length < 8) {
            showToast("Passphrase too short (min 8 chars).", 'warning');
            return null;
        }
        const skHex = nsecToHex(skInput);
        if (!isNostrId(skHex)) throw new Error("Invalid Nostr private key format.");

        const pk = getPk(skHex);
        const encryptedSk = await encrypt(skHex, passphrase);
        const identity = { pk, authM: 'import', eSk: encryptedSk };
        await confSvc.saveId(identity);
        appStore.set({ user: { pk, authM: 'import' } });
        _locSk = skHex;
        return { pk, sk: skHex };
    }, "Private key imported successfully.", "Key import error")),

    async getSk(promptPassphrase = true) {
        const user = appStore.get().user;
        if (!user || user.authM === 'nip07') return null;
        if (_locSk) return _locSk;

        const identity = await confSvc.getId();
        if (!identity?.eSk || !promptPassphrase) return null;

        const passphrase = await showPassphraseModal(
            "Decrypt Private Key",
            "Enter your passphrase to decrypt your private key:"
        );

        if (!passphrase) {
            showToast("Decryption cancelled.", 'info');
            return null;
        }
        return withToast(async () => {
            const decryptedSk = await decrypt(identity.eSk, passphrase);
            _locSk = decryptedSk;
            return decryptedSk;
        }, null, "Decryption failed. Incorrect passphrase?")();
    },

    chgPass: withLoading(withToast(async (oldPassphrase, newPassphrase) => {
        const identity = await confSvc.getId();
        if (!identity?.eSk || !['local', 'import'].includes(identity.authM)) {
            throw new Error("No local key to change passphrase for.");
        }
        const decryptedSk = await decrypt(identity.eSk, oldPassphrase);
        if (!decryptedSk) throw new Error("Old passphrase incorrect.");

        const newEncryptedSk = await encrypt(decryptedSk, newPassphrase);
        await confSvc.saveId({ ...identity, eSk: newEncryptedSk });
        _locSk = decryptedSk;
    }, "Passphrase changed successfully.", "Passphrase change failed")),

    logout() {
        _locSk = null;
        confSvc.clearId();
        showToast("Logged out successfully.", 'info');
    },

    currU: () => appStore.get().user,

    async signEv(event) {
        const user = appStore.get().user;
        if (!user) throw new Error("No Nostr identity connected. Please connect or create one.");

        return user.authM === 'nip07' ? this.signEventNip07(event) : this.signEventLocal(event, user.pk);
    },

    async signEventNip07(event) {
        if (!window.nostr?.signEvent) throw new Error("NIP-07 extension not found or not enabled.");
        try {
            return await window.nostr.signEvent(event);
        } catch (e) {
            throw new Error("NIP-07 signing failed: " + e.message);
        }
    },

    async signEventLocal(eventTemplate, pubkey) {
        const sk = await idSvc.getSk(true);
        if (!sk) throw new Error("Private key not available for signing. Passphrase might be needed.");
        return signEvNostr(eventTemplate, sk);
    }
};
