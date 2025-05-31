import {npubToHex, C} from '../utils.js';
import {appStore} from '../store.js';
import {confSvc, nostrSvc} from '../services.js';
import {KeyManagementSection} from './settings/keyManagement.js';
import {MapTilesSection} from './settings/mapTiles.js';
import {ImageHostSection} from './settings/imageHost.js';
import {DataManagementSection} from './settings/dataManagement.js';
import {OfflineQueueSection} from './settings/offlineQueue.js';
import {ConfigurableListSetting} from './components/ConfigurableListSetting.js';
import {withLoading, withToast} from '../decorators.js';
import {showConfirmModal} from './modals.js';
import {showToast} from '../utils.js';

import {RelayItem} from './components/settings/RelayItem.js';
import {FocusTagItem} from './components/settings/FocusTagItem.js';
import {CategoryItem} from './components/settings/CategoryItem.js';
import {MutePubkeyItem} from './components/settings/MutePubkeyItem.js';
import {FollowedPubkeyItem} from './components/settings/FollowedPubkeyItem.js';

const createAddLogicHandler = (confSvcMethod, itemExistsChecker, itemExistsErrorMsg) => async inputValue => {
    if (!inputValue) throw new Error("Input cannot be empty.");
    if (itemExistsChecker?.(inputValue)) throw new Error(itemExistsErrorMsg || "Item already exists.");
    await confSvcMethod(inputValue);
};

const addRelayLogic = createAddLogicHandler(
    async url => confSvc.setRlys([...appStore.get().relays, { url, read: true, write: true, status: '?' }]),
    url => appStore.get().relays.some(r => r.url === url),
    "Relay already exists."
);

const handleRelayRemove = r => {
    const updatedRelays = appStore.get().relays.filter(rl => rl.url !== r.url);
    confSvc.setRlys(updatedRelays);
    nostrSvc.discAllRlys();
    nostrSvc.connRlys();
};

const addCategoryLogic = createAddLogicHandler(
    cat => confSvc.setCats([...appStore.get().settings.cats, cat]),
    cat => appStore.get().settings.cats.includes(cat),
    "Category already exists."
);

const handleCategoryRemove = c => confSvc.setCats(appStore.get().settings.cats.filter(cat => cat !== c));

const addFocusTagLogic = createAddLogicHandler(
    async tag => {
        tag = tag.startsWith('#') ? tag : '#' + tag;
        await confSvc.setFocusTags([...appStore.get().focusTags, {tag, active: false}]);
    },
    tag => appStore.get().focusTags.some(t => t.tag === (tag.startsWith('#') ? tag : '#' + tag)),
    "Focus tag already exists."
);

const handleFocusTagRemove = t => {
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

const addMutePubkeyLogic = createAddLogicHandler(
    async pk => confSvc.addMute(npubToHex(pk)),
    pk => appStore.get().settings.mute.includes(npubToHex(pk)),
    "Pubkey already muted."
);

const handleMutePubkeyRemove = pk => confSvc.rmMute(pk);

const addFollowedPubkeyLogic = createAddLogicHandler(
    async pk => confSvc.addFollowed(npubToHex(pk)),
    pk => appStore.get().followedPubkeys.some(f => f.pk === npubToHex(pk)),
    "User already followed."
);

const handleFollowedPubkeyRemove = f => confSvc.rmFollowed(f.pk);

const reconnectRelays = () => {
    nostrSvc.discAllRlys();
    nostrSvc.connRlys();
};

const removeActionConfig = (title, message, onClickHandler) => ({
    label: 'Remove',
    className: 'remove-btn',
    onClick: onClickHandler,
    confirm: { title, message }
});

const setupFollowedListUniqueListeners = (fields) => {
    const importContactsBtn = fields['import-contacts-btn'];
    const publishContactsBtn = fields['publish-contacts-btn'];

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

export const settingsSections = [
    {
        type: 'list',
        title: 'Relays',
        listId: 'rly-list',
        formFields: [
            { label: 'New Relay URL:', type: 'url', id: 'new-rly-url', name: 'newRelayUrl', placeholder: 'wss://new.relay.com' },
            { type: 'button', id: 'add-rly-btn', label: 'Add Relay', buttonType: 'button' },
            { type: 'button', id: 'save-rlys-btn', label: 'Save & Reconnect Relays', buttonType: 'button' }
        ],
        addInputId: 'new-rly-url',
        addBtnId: 'add-rly-btn',
        addLogic: addRelayLogic,
        itemRenderer: (item) => new RelayItem(item).element,
        actionsConfig: [removeActionConfig('Remove Relay', 'Are you sure you want to remove this relay?', handleRelayRemove)],
        itemWrapperClass: 'relay-entry',
        saveBtnId: 'save-rlys-btn',
        onSaveCallback: reconnectRelays,
        getItems: () => appStore.get().relays,
        addSuccessMsg: "Relay added.",
        addErrorMsg: "Error adding relay",
        renderer: ConfigurableListSetting
    },
    {
        type: 'section',
        title: 'Key Management',
        renderer: KeyManagementSection
    },
    {
        type: 'list',
        title: 'Focus Tags',
        listId: 'focus-tag-list',
        formFields: [
            { label: 'New Focus Tag:', type: 'text', id: 'new-focus-tag-input', name: 'newFocusTag', placeholder: '#NewFocusTag' },
            { type: 'button', id: 'add-focus-tag-btn', label: 'Add Focus Tag', buttonType: 'button' },
            { type: 'button', id: 'save-focus-tags-btn', label: 'Save Focus Tags', buttonType: 'button' }
        ],
        addInputId: 'new-focus-tag-input',
        addBtnId: 'add-focus-tag-btn',
        addLogic: addFocusTagLogic,
        itemRenderer: (item) => new FocusTagItem(item).element,
        actionsConfig: [removeActionConfig('Remove Focus Tag', 'Are you sure you want to remove this focus tag?', handleFocusTagRemove)],
        itemWrapperClass: 'focus-tag-entry',
        saveBtnId: 'save-focus-tags-btn',
        onSaveCallback: () => nostrSvc.refreshSubs(),
        getItems: () => appStore.get().focusTags,
        addSuccessMsg: "Focus tag added.",
        addErrorMsg: "Error adding focus tag",
        renderer: ConfigurableListSetting
    },
    {
        type: 'list',
        title: 'Categories',
        listId: 'cat-list',
        formFields: [
            { label: 'New Category Name:', type: 'text', id: 'new-cat-name', name: 'newCategory', placeholder: 'New Category' },
            { type: 'button', id: 'add-cat-btn', label: 'Add Category', buttonType: 'button' },
            { type: 'button', id: 'save-cats-btn', label: 'Save Categories', buttonType: 'button' }
        ],
        addInputId: 'new-cat-name',
        addBtnId: 'add-cat-btn',
        addLogic: addCategoryLogic,
        itemRenderer: (item) => new CategoryItem(item).element,
        actionsConfig: [removeActionConfig('Remove Category', 'Are you sure you want to remove this category?', handleCategoryRemove)],
        itemWrapperClass: 'category-entry',
        saveBtnId: 'save-cats-btn',
        getItems: () => appStore.get().settings.cats,
        addSuccessMsg: "Category added.",
        addErrorMsg: "Error adding category",
        renderer: ConfigurableListSetting
    },
    {
        type: 'section',
        title: 'Map Tiles',
        renderer: MapTilesSection
    },
    {
        type: 'section',
        title: 'Image Host',
        renderer: ImageHostSection
    },
    {
        type: 'list',
        title: 'Mute List',
        listId: 'mute-list',
        formFields: [
            { label: 'New Muted Pubkey:', type: 'text', id: 'new-mute-pk-input', name: 'newMutePk', placeholder: 'npub... or hex pubkey' },
            { type: 'button', id: 'add-mute-btn', label: 'Add to Mute List', buttonType: 'button' },
            { type: 'button', id: 'save-mute-list-btn', label: 'Save Mute List', buttonType: 'button' }
        ],
        addInputId: 'new-mute-pk-input',
        addBtnId: 'add-mute-btn',
        addLogic: addMutePubkeyLogic,
        itemRenderer: (item) => new MutePubkeyItem(item).element,
        actionsConfig: [removeActionConfig('Remove Muted Pubkey', 'Are you sure you want to unmute this pubkey?', handleMutePubkeyRemove)],
        itemWrapperClass: 'mute-entry',
        saveBtnId: 'save-mute-list-btn',
        getItems: () => appStore.get().settings.mute,
        addSuccessMsg: "Pubkey added to mute list.",
        addErrorMsg: "Error adding pubkey to mute list",
        renderer: ConfigurableListSetting
    },
    {
        type: 'list',
        title: 'Followed Users (NIP-02)',
        listId: 'followed-list',
        formFields: [
            { label: 'New Followed Pubkey:', type: 'text', id: 'new-followed-pk-input', name: 'newFollowedPk', placeholder: 'npub... or hex pubkey' },
            { type: 'button', id: 'add-followed-btn', label: 'Add to Followed', buttonType: 'button' },
            { type: 'button', id: 'save-followed-btn', label: 'Save Followed List', buttonType: 'button' },
            { type: 'hr' },
            { label: 'Import NIP-02 Contacts', type: 'button', id: 'import-contacts-btn', buttonType: 'button' },
            { label: 'Publish NIP-02 Contacts', type: 'button', id: 'publish-contacts-btn', buttonType: 'button' }
        ],
        addInputId: 'new-followed-pk-input',
        addBtnId: 'add-followed-btn',
        addLogic: addFollowedPubkeyLogic,
        itemRenderer: (item) => new FollowedPubkeyItem(item).element,
        actionsConfig: [removeActionConfig('Unfollow User', 'Are you sure you want to unfollow this user?', handleFollowedPubkeyRemove)],
        itemWrapperClass: 'followed-entry',
        saveBtnId: 'save-followed-btn',
        uniqueListenersSetup: setupFollowedListUniqueListeners,
        getItems: () => appStore.get().followedPubkeys,
        addSuccessMsg: "User added to followed list.",
        addErrorMsg: "Error adding user to followed list",
        renderer: ConfigurableListSetting
    },
    {
        type: 'section',
        title: 'Offline Queue',
        renderer: OfflineQueueSection
    },
    {
        type: 'section',
        title: 'Data Management',
        renderer: DataManagementSection
    }
];
