import { appStore } from '../../store.js';
import { confSvc, nostrSvc } from '../../services.js';
import { $, formatNpubShort, showToast } from '../../utils.js';
import { withLoading, withToast } from '../../decorators.js';
import { renderForm } from '../forms.js';
import { createListSectionRenderer } from '../settingsHelpers.js';
import { showConfirmModal } from '../modals.js';

/**
 * Renders the followed users list and its management form.
 * @param {HTMLElement} modalContent The parent modal content element.
 * @returns {HTMLElement} The rendered form element.
 */
export const renderFollowedUsersSection = (modalContent) => {
    const followedUsersFormFields = [
        { label: 'New Followed Pubkey:', type: 'text', id: 'new-followed-pk-input', name: 'newFollowedPk', placeholder: 'npub... or hex pubkey' },
        { label: 'Add to Followed', type: 'button', id: 'add-followed-btn', buttonType: 'button' },
        { label: 'Save Followed List', type: 'button', id: 'save-followed-btn', buttonType: 'button' },
        { type: 'hr' },
        { label: 'Import NIP-02 Contacts', type: 'button', id: 'import-contacts-btn', buttonType: 'button' },
        { label: 'Publish NIP-02 Contacts', type: 'button', id: 'publish-contacts-btn', buttonType: 'button' }
    ];

    const form = renderForm(followedUsersFormFields, {}, { id: 'followed-list-form' });
    modalContent.appendChild(form); // Append to modalContent directly

    return form;
};

/**
 * Renders the list of followed pubkeys.
 * @param {HTMLElement} modalContent The parent modal content element.
 */
export const renderFollowedList = createListSectionRenderer('followed-list',
    f => createEl('span', { textContent: formatNpubShort(f.pk) }),
    [{
        label: 'Unfollow',
        className: 'remove-followed-btn',
        onClick: f => confSvc.rmFollowed(f.pk),
        confirm: { title: 'Unfollow User', message: 'Are you sure you want to unfollow this user?' }
    }],
    'followed-entry'
);

/**
 * Sets up unique event listeners for the followed users section (import/publish contacts).
 * @param {HTMLElement} modalContent The root element containing the followed users section.
 */
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
