import {C, createEl, formatNpubShort, npubToHex, sanitizeHTML, showToast} from '../utils.js';
import {appStore} from '../store.js';
import {confSvc, nostrSvc} from '../services.js';
import {renderKeyManagementSection} from './settings/keyManagement.js';
import {renderMapTilesSection} from './settings/mapTiles.js';
import {renderImageHostSection} from './settings/imageHost.js';
import {setupFollowedListUniqueListeners} from './settingsUtils.js';
import {renderDataManagementSection} from './settings/dataManagement.js';
import {offlineQueueActionsConfig, offlineQueueItemRenderer, renderOfflineQueue} from './settings/offlineQueue.js';

const createAddLogicHandler = (confSvcMethod, itemExistsChecker, successMsg, warningMsg, errorMsg) => async inputValue => {
    if (!inputValue) {
        showToast("Input cannot be empty.", 'warning');
        return false;
    }
    try {
        if (itemExistsChecker?.(inputValue)) {
            showToast(warningMsg || "Item already exists.", 'info');
            return false;
        }
        await confSvcMethod(inputValue);
        showToast(successMsg || "Item added.", 'success');
        return true;
    } catch (e) {
        showToast(`${errorMsg || 'Error adding item'}: ${e.message}`, 'error');
        return false;
    }
};

const addRelayLogic = createAddLogicHandler(
    async url => confSvc.setRlys([...appStore.get().relays, { url, read: true, write: true, status: '?' }]),
    url => appStore.get().relays.some(r => r.url === url),
    "Relay added.",
    "Relay already exists.",
    "Error adding relay"
);

const addCategoryLogic = createAddLogicHandler(
    cat => confSvc.setCats([...appStore.get().settings.cats, cat]),
    cat => appStore.get().settings.cats.includes(cat),
    "Category added.",
    "Category already exists.",
    "Error adding category"
);

const addFocusTagLogic = createAddLogicHandler(
    async tag => {
        tag = tag.startsWith('#') ? tag : '#' + tag;
        await confSvc.setFocusTags([...appStore.get().focusTags, {tag, active: false}]);
    },
    tag => appStore.get().focusTags.some(t => t.tag === (tag.startsWith('#') ? tag : '#' + tag)),
    "Focus tag added.",
    "Focus tag already exists.",
    "Error adding focus tag"
);

const addMutePubkeyLogic = createAddLogicHandler(
    async pk => confSvc.addMute(npubToHex(pk)),
    pk => appStore.get().settings.mute.includes(npubToHex(pk)),
    "Pubkey added to mute list.",
    "Pubkey already muted.",
    "Error adding pubkey to mute list"
);

const addFollowedPubkeyLogic = createAddLogicHandler(
    async pk => confSvc.addFollowed(npubToHex(pk)),
    pk => appStore.get().followedPubkeys.some(f => f.pk === npubToHex(pk)),
    "User added to followed list.",
    "User already followed.",
    "Error adding user to followed list"
);

const reconnectRelays = () => {
    nostrSvc.discAllRlys();
    nostrSvc.connRlys();
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
        formId: 'relay-form',
        addInputId: 'new-rly-url',
        addBtnId: 'add-rly-btn',
        addLogic: addRelayLogic,
        itemRenderer: r => createEl('span', { textContent: `${sanitizeHTML(r.url)} (${r.read ? 'R' : ''}${r.write ? 'W' : ''}) - ${sanitizeHTML(r.status)}` }),
        actionsConfig: [{
            label: 'Remove',
            className: 'remove-relay-btn',
            onClick: r => {
                const updatedRelays = appStore.get().relays.filter(rl => rl.url !== r.url);
                confSvc.setRlys(updatedRelays);
                reconnectRelays();
            },
            confirm: { title: 'Remove Relay', message: 'Are you sure you want to remove this relay?' }
        }],
        itemWrapperClass: 'relay-entry',
        saveBtnId: 'save-rlys-btn',
        onSaveCallback: reconnectRelays
    },
    {
        type: 'section',
        title: 'Key Management',
        renderer: renderKeyManagementSection
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
        formId: 'focus-tag-form',
        addInputId: 'new-focus-tag-input',
        addBtnId: 'add-focus-tag-btn',
        addLogic: addFocusTagLogic,
        itemRenderer: ft => createEl('div', {}, [
            createEl('span', { textContent: `${sanitizeHTML(ft.tag)}${ft.active ? ' (Active)' : ''}` }),
            createEl('label', {}, [
                createEl('input', {
                    type: 'radio',
                    name: 'activeFocusTag',
                    value: ft.tag,
                    checked: ft.active,
                    onchange: () => {
                        const updatedTags = appStore.get().focusTags.map(t => ({ ...t, active: t.tag === ft.tag }));
                        confSvc.setFocusTags(updatedTags);
                        confSvc.setCurrentFocusTag(ft.tag);
                        nostrSvc.refreshSubs();
                    }
                }),
                ` Set Active`
            ])
        ]),
        actionsConfig: [{
            label: 'Remove',
            className: 'remove-focus-tag-btn',
            onClick: t => {
                const updatedTags = appStore.get().focusTags.filter(ft => ft.tag !== t.tag);
                confSvc.setFocusTags(updatedTags);
                if (t.active && updatedTags.length) {
                    confSvc.setCurrentFocusTag(updatedTags[0].tag);
                    updatedTags[0].active = true;
                } else if (!updatedTags.length) {
                    confSvc.setCurrentFocusTag(C.FOCUS_TAG_DEFAULT);
                    confSvc.setFocusTags([{ tag: C.FOCUS_TAG_DEFAULT, active: true }]);
                }
            },
            confirm: { title: 'Remove Focus Tag', message: 'Are you sure you want to remove this focus tag?' }
        }],
        itemWrapperClass: 'focus-tag-entry',
        saveBtnId: 'save-focus-tags-btn',
        onSaveCallback: () => nostrSvc.refreshSubs()
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
        formId: 'category-form',
        addInputId: 'new-cat-name',
        addBtnId: 'add-cat-btn',
        addLogic: addCategoryLogic,
        itemRenderer: c => createEl('span', { textContent: sanitizeHTML(c) }),
        actionsConfig: [{
            label: 'Remove',
            className: 'remove-category-btn',
            onClick: c => confSvc.setCats(appStore.get().settings.cats.filter(cat => cat !== c)),
            confirm: { title: 'Remove Category', message: 'Are you sure you want to remove this category?' }
        }],
        itemWrapperClass: 'category-entry',
        saveBtnId: 'save-cats-btn'
    },
    {
        type: 'section',
        title: 'Map Tiles',
        renderer: renderMapTilesSection
    },
    {
        type: 'section',
        title: 'Image Host',
        renderer: renderImageHostSection
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
        formId: 'mute-list-form',
        addInputId: 'new-mute-pk-input',
        addBtnId: 'add-mute-btn',
        addLogic: addMutePubkeyLogic,
        itemRenderer: pk => createEl('span', { textContent: formatNpubShort(pk) }),
        actionsConfig: [{
            label: 'Remove',
            className: 'remove-mute-btn',
            onClick: pk => confSvc.rmMute(pk),
            confirm: { title: 'Remove Muted Pubkey', message: 'Are you sure you want to unmute this pubkey?' }
        }],
        itemWrapperClass: 'mute-entry',
        saveBtnId: 'save-mute-list-btn'
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
        formId: 'followed-list-form',
        addInputId: 'new-followed-pk-input',
        addBtnId: 'add-followed-btn',
        addLogic: addFollowedPubkeyLogic,
        itemRenderer: f => createEl('span', { textContent: formatNpubShort(f.pk) }),
        actionsConfig: [{
            label: 'Unfollow',
            className: 'remove-followed-btn',
            onClick: f => confSvc.rmFollowed(f.pk),
            confirm: { title: 'Unfollow User', message: 'Are you sure you want to unfollow this user?' }
        }],
        itemWrapperClass: 'followed-entry',
        saveBtnId: 'save-followed-btn',
        uniqueListenersSetup: setupFollowedListUniqueListeners
    },
    {
        type: 'offline-queue',
        title: 'Offline Queue',
        listId: 'offline-queue-list',
        itemRenderer: offlineQueueItemRenderer,
        actionsConfig: modalContent => offlineQueueActionsConfig(modalContent),
        itemWrapperClass: 'offline-q-entry',
        customRenderLogic: renderOfflineQueue
    },
    {
        type: 'section',
        title: 'Data Management',
        renderer: renderDataManagementSection
    }
];
