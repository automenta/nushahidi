import { appStore } from '../../store.js';
import { confSvc, nostrSvc, dbSvc } from '../../services.js';
import { C, createEl, showToast, npubToHex, formatNpubShort, sanitizeHTML } from '../../utils.js';
import { renderForm, renderList, setupAddRemoveListSection } from '../forms.js';
import { showConfirmModal } from '../modals.js';
import { withLoading, withToast } from '../decorators.js';

// Generic function to create an add logic handler
export const createAddLogicHandler = (confSvcMethod, itemExistsChecker, successMsg, warningMsg, errorMsg) => async (inputValue) => {
    if (!inputValue) {
        showToast("Input cannot be empty.", 'warning');
        return false;
    }
    try {
        if (itemExistsChecker && itemExistsChecker(inputValue)) {
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

// Generic function to create a list section renderer
export const createListSectionRenderer = (containerId, itemRenderer, actionsConfig, itemWrapperClass) => (scopeElement) => {
    let items;
    if (containerId === 'rly-list') {
        items = appStore.get().relays;
    } else if (containerId === 'followed-list') {
        items = appStore.get().followedPubkeys;
    } else {
        items = appStore.get().settings[containerId.replace('-list', '')];
    }

    renderList(containerId, items || [], itemRenderer, actionsConfig, itemWrapperClass, scopeElement);
};

// Specific add logic handlers
export const addRelayLogic = createAddLogicHandler(
    async (url) => confSvc.setRlys([...appStore.get().relays, { url, read: true, write: true, status: '?' }]),
    (url) => appStore.get().relays.some(r => r.url === url),
    "Relay added.",
    "Relay already exists.",
    "Error adding relay"
);

export const addCategoryLogic = createAddLogicHandler(
    (cat) => confSvc.setCats([...appStore.get().settings.cats, cat]),
    (cat) => appStore.get().settings.cats.includes(cat),
    "Category added.",
    "Category already exists.",
    "Error adding category"
);

export const addFocusTagLogic = createAddLogicHandler(
    async (tag) => {
        if (!tag.startsWith('#')) tag = '#' + tag;
        confSvc.setFocusTags([...appStore.get().focusTags, { tag, active: false }]);
    },
    (tag) => appStore.get().focusTags.some(t => t.tag === (tag.startsWith('#') ? tag : '#' + tag)),
    "Focus tag added.",
    "Focus tag already exists.",
    "Error adding focus tag"
);

export const addMutePubkeyLogic = createAddLogicHandler(
    async (pk) => confSvc.addMute(npubToHex(pk)),
    (pk) => appStore.get().settings.mute.includes(npubToHex(pk)),
    "Pubkey added to mute list.",
    "Pubkey already muted.",
    "Error adding pubkey to mute list"
);

export const addFollowedPubkeyLogic = createAddLogicHandler(
    async (pk) => confSvc.addFollowed(npubToHex(pk)),
    (pk) => appStore.get().followedPubkeys.some(f => f.pk === npubToHex(pk)),
    "User added to followed list.",
    "User already followed.",
    "Error adding user to followed list"
);

// New generalized function to render a list-based settings section
export function renderConfigurableListSetting(wrapper, config) {
    wrapper.appendChild(createEl('section', {}, [
        createEl('h3', { textContent: config.title }),
        createEl('div', { id: config.listId }),
        renderForm(config.formFields, {}, { id: config.formId })
    ]));
    wrapper.appendChild(createEl('hr'));

    const listRenderer = createListSectionRenderer(config.listId, config.itemRenderer, config.actionsConfig, config.itemWrapperClass);

    setupAddRemoveListSection({
        modalContent: wrapper,
        addInputId: config.addInputId,
        addBtnId: config.addBtnId,
        addLogic: config.addLogic,
        listRenderer: () => listRenderer(wrapper), // Pass wrapper as scopeElement
        saveBtnId: config.saveBtnId,
        onSaveCallback: config.onSaveCallback
    });

    // Initial render of the list
    listRenderer(wrapper);

    // Call any unique listeners setup for this section
    if (config.uniqueListenersSetup) {
        config.uniqueListenersSetup(wrapper);
    }
}

// Specific renderers for list items (used by createListSectionRenderer)
export const renderRelays = createListSectionRenderer('rly-list',
    r => createEl('span', { textContent: `${sanitizeHTML(r.url)} (${r.read ? 'R' : ''}${r.write ? 'W' : ''}) - ${sanitizeHTML(r.status)}` }),
    [{
        label: 'Remove',
        className: 'remove-relay-btn',
        onClick: r => {
            const updatedRelays = appStore.get().relays.filter(rl => rl.url !== r.url);
            confSvc.setRlys(updatedRelays);
            nostrSvc.discAllRlys();
            nostrSvc.connRlys();
        },
        confirm: { title: 'Remove Relay', message: 'Are you sure you want to remove this relay?' }
    }],
    'relay-entry'
);

export const renderCategories = createListSectionRenderer('cat-list',
    c => createEl('span', { textContent: sanitizeHTML(c) }),
    [{
        label: 'Remove',
        className: 'remove-category-btn',
        onClick: c => {
            const updatedCats = appStore.get().settings.cats.filter(cat => cat !== c);
            confSvc.setCats(updatedCats);
        },
        confirm: { title: 'Remove Category', message: 'Are you sure you want to remove this category?' }
    }],
    'category-entry'
);

export const renderFocusTags = createListSectionRenderer('focus-tag-list',
    ft => {
        const span = createEl('span', { textContent: `${sanitizeHTML(ft.tag)}${ft.active ? ' (Active)' : ''}` });
        const radio = createEl('input', {
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
        });
        const label = createEl('label', {}, [radio, ` Set Active`]);
        return createEl('div', {}, [span, label]);
    },
    [{
        label: 'Remove',
        className: 'remove-focus-tag-btn',
        onClick: t => {
            const updatedTags = appStore.get().focusTags.filter(ft => ft.tag !== t.tag);
            confSvc.setFocusTags(updatedTags);
            if (t.active && updatedTags.length > 0) {
                confSvc.setCurrentFocusTag(updatedTags[0].tag);
                updatedTags[0].active = true;
            } else if (updatedTags.length === 0) {
                confSvc.setCurrentFocusTag(C.FOCUS_TAG_DEFAULT);
                confSvc.setFocusTags([{ tag: C.FOCUS_TAG_DEFAULT, active: true }]);
            }
        },
        confirm: { title: 'Remove Focus Tag', message: 'Are you sure you want to remove this focus tag?' }
    }],
    'focus-tag-entry'
);

export const renderMuteList = createListSectionRenderer('mute-list',
    pk => createEl('span', { textContent: formatNpubShort(pk) }),
    [{
        label: 'Remove',
        className: 'remove-mute-btn',
        onClick: pk => confSvc.rmMute(pk),
        confirm: { title: 'Remove Muted Pubkey', message: 'Are you sure you want to unmute this pubkey?' }
    }],
    'mute-entry'
);

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

export const getOfflineQueueEventType = (kind) => {
    switch (kind) {
        case C.NOSTR_KIND_REPORT: return 'Report';
        case C.NOSTR_KIND_REACTION: return 'Reaction';
        case C.NOSTR_KIND_NOTE: return 'Comment';
        case 5: return 'Deletion';
        case C.NOSTR_KIND_PROFILE: return 'Profile';
        case C.NOSTR_KIND_CONTACTS: return 'Contacts';
        default: return `Kind ${kind}`;
    }
};

export const offlineQueueItemRenderer = item => {
    const eventType = getOfflineQueueEventType(item.event.kind);
    const timestamp = new Date(item.ts).toLocaleString();
    const contentSnippet = item.event.content.substring(0, 50) + (item.event.content.length > 50 ? '...' : '');
    const eventIdSnippet = item.event.id.substring(0, 8);
    return createEl('span', { innerHTML: `<strong>${sanitizeHTML(eventType)}</strong> (${timestamp}) - ID: ${sanitizeHTML(eventIdSnippet)}... <br>Content: <em>${sanitizeHTML(contentSnippet || 'N/A')}</em>` });
};

export const offlineQueueActionsConfig = (modalContent) => [
    {
        label: 'Retry',
        className: 'retry-offline-q-btn',
        onClick: withLoading(withToast(async (item) => {
            await nostrSvc.pubEv(item.event);
            await dbSvc.rmOfflineQ(item.qid);
            renderOfflineQueue(modalContent);
        }, null, "Error retrying event")),
    },
    {
        label: 'Delete',
        className: 'remove-offline-q-btn',
        onClick: withLoading(withToast(async (item) => {
            await dbSvc.rmOfflineQ(item.qid);
            renderOfflineQueue(modalContent);
        }, null, "Error deleting event")),
    }
];

export const renderOfflineQueue = async (modalContent) => {
    const queueItems = await dbSvc.getOfflineQ();
    renderList('offline-queue-list', queueItems, offlineQueueItemRenderer, offlineQueueActionsConfig(modalContent), 'offline-q-entry', modalContent);
};
