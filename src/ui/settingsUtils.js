import {appStore} from '../store.js';
import {confSvc, nostrSvc} from '../services.js';
import {createEl, showToast, sanitizeHTML, formatNpubShort} from '../utils.js';
import {showConfirmModal} from '../modals.js';
import {withLoading, withToast} from '../decorators.js';
import {C} from '../utils.js';

export function getSettingItems(listId) {
    switch (listId) {
        case 'rly-list': return appStore.get().relays;
        case 'followed-list': return appStore.get().followedPubkeys;
        case 'focus-tag-list': return appStore.get().focusTags;
        case 'cat-list': return appStore.get().settings.cats;
        case 'mute-list': return appStore.get().settings.mute;
        default: return [];
    }
}

export const setupFollowedListUniqueListeners = (importContactsBtn, publishContactsBtn) => {
    importContactsBtn.onclick = withLoading(withToast(async () => {
        if (!appStore.get().user) throw new Error("Please connect your Nostr identity to import contacts.");
        const contacts = await nostrSvc.fetchContacts();
        if (!contacts.length) return "No NIP-02 contact list found on relays for your account.";

        const currentFollowed = appStore.get().followedPubkeys.map(f => f.pk);
        const newFollowed = contacts.filter(c => !currentFollowed.includes(c.pubkey)).map(c => ({ pk: c.pubkey, followedAt: Date.now() }));
        if (!newFollowed.length) return "No new contacts found to import.";

        await confSvc.setFollowedPubkeys([...appStore.get().followedPubkeys, ...newFollowed]);
        return `Imported ${newFollowed.length} contacts from Nostr.`;
    }, null, "Error importing contacts"));

    publishContactsBtn.onclick = () => {
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

export const renderRelayItem = r => createEl('span', { textContent: `${sanitizeHTML(r.url)} (${r.read ? 'R' : ''}${r.write ? 'W' : ''}) - ${sanitizeHTML(r.status)}` });

export const handleRelayRemove = r => {
    const updatedRelays = appStore.get().relays.filter(rl => rl.url !== r.url);
    confSvc.setRlys(updatedRelays);
    nostrSvc.discAllRlys();
    nostrSvc.connRlys();
};

export const renderFocusTagItem = ft => createEl('div', {}, [
    createEl('span', { textContent: `${sanitizeHTML(ft.tag)}${ft.active ? ' (Active)' : ''}` }),
    createEl('label', {}, [
        createEl('input', {
            type: 'radio',
            name: 'activeFocusTag',
            value: ft.tag,
            checked: ft.active,
            onchange: () => handleFocusTagRadioChange(ft.tag)
        }),
        ` Set Active`
    ])
]);

export const handleFocusTagRadioChange = tag => {
    const updatedTags = appStore.get().focusTags.map(t => ({ ...t, active: t.tag === tag }));
    confSvc.setFocusTags(updatedTags);
    confSvc.setCurrentFocusTag(tag);
    nostrSvc.refreshSubs();
};

export const handleFocusTagRemove = t => {
    const updatedTags = appStore.get().focusTags.filter(ft => ft.tag !== t.tag);
    confSvc.setFocusTags(updatedTags);
    if (t.active && updatedTags.length) {
        confSvc.setCurrentFocusTag(updatedTags[0].tag);
        updatedTags[0].active = true;
    } else if (!updatedTags.length) {
        confSvc.setCurrentFocusTag(C.FOCUS_TAG_DEFAULT);
        confSvc.setFocusTags([{ tag: C.FOCUS_TAG_DEFAULT, active: true }]);
    }
};

export const renderCategoryItem = c => createEl('span', { textContent: sanitizeHTML(c) });

export const handleCategoryRemove = c => confSvc.setCats(appStore.get().settings.cats.filter(cat => cat !== c));

export const renderMutePubkeyItem = pk => createEl('span', { textContent: formatNpubShort(pk) });

export const handleMutePubkeyRemove = pk => confSvc.rmMute(pk);

export const renderFollowedPubkeyItem = f => createEl('span', { textContent: formatNpubShort(f.pk) });

export const handleFollowedPubkeyRemove = f => confSvc.rmFollowed(f.pk);
