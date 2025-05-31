import { appStore } from '../../store.js';
import { confSvc, nostrSvc } from '../../services.js';
import { $, formatNpubShort, showToast, createEl } from '../../utils.js';
import { withLoading, withToast } from '../../decorators.js';
import { showConfirmModal } from '../modals.js';

// renderFollowedUsersSection and renderFollowedList are no longer defined here.
// Their functionality is now integrated into settingsUtils.js and settingsPanel.js.

export const setupFollowedListUniqueListeners = (modalContent) => {
    $('#import-contacts-btn', modalContent).onclick = withLoading(withToast(async () => {
        if (!appStore.get().user) {
            throw new Error("Please connect your Nostr identity to import contacts.");
        }
        const contacts = await nostrSvc.fetchContacts();
        if (contacts.length > 0) {
            const currentFollowed = appStore.get().followedPubkeys.map(f => f.pk);
            const newFollowed = contacts.filter(c => !currentFollowed.includes(c.pubkey)).map(c => ({ pk: c.pubkey, followedAt: Date.now() }));
            if (newFollowed.length > 0) {
                confSvc.setFollowedPubkeys([...appStore.get().followedPubkeys, ...newFollowed]);
                return `Imported ${newFollowed.length} contacts from Nostr.`;
            } else {
                return "No new contacts found to import.";
            }
        } else {
            return "No NIP-02 contact list found on relays for your account.";
        }
    }, null, "Error importing contacts"));

    $('#publish-contacts-btn', modalContent).onclick = () => {
        if (!appStore.get().user) {
            showToast("Please connect your Nostr identity to publish contacts.", 'warning');
            return;
        }
        showConfirmModal(
            "Publish Contacts",
            "This will publish your current followed list as a NIP-02 contact list (Kind 3 event) to your connected relays. This will overwrite any existing Kind 3 event for your pubkey. Continue?",
            withLoading(withToast(async () => {
                const contactsToPublish = appStore.get().followedPubkeys.map(f => ({ pubkey: f.pk, relay: '', petname: '' }));
                await nostrSvc.pubContacts(contactsToPublish);
            }, null, "Error publishing contacts")),
            () => showToast("Publish contacts cancelled.", 'info')
        );
    };
};
