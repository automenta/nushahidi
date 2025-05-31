import { appStore } from '../store.js';
import { confSvc, nostrSvc, dbSvc } from '../services.js';
import { C, createEl, showToast, npubToHex, formatNpubShort, sanitizeHTML } from '../utils.js';
import { renderForm, renderList, setupAddRemoveListSection } from '../forms.js';
import { showConfirmModal } from '../modals.js';
import { withLoading, withToast } from '../decorators.js';

// Generic function to create an add logic handler - MOVED TO settingsConfig.js
// export const createAddLogicHandler = (confSvcMethod, itemExistsChecker, successMsg, warningMsg, errorMsg) => async (inputValue) => { ... };

// Generic function to create a list section renderer - REMOVED, logic integrated into renderConfigurableListSetting
// export const createListSectionRenderer = (containerId, itemRenderer, actionsConfig, itemWrapperClass) => (scopeElement) => { ... };

// Specific add logic handlers - MOVED TO settingsConfig.js
// export const addRelayLogic = createAddLogicHandler(...);
// export const addCategoryLogic = createAddLogicHandler(...);
// export const addFocusTagLogic = createAddLogicHandler(...);
// export const addMutePubkeyLogic = createAddLogicHandler(...);
// export const addFollowedPubkeyLogic = createAddLogicHandler(...);

// New generalized function to render a list-based settings section
export function renderConfigurableListSetting(wrapper, config) {
    wrapper.appendChild(createEl('section', {}, [
        createEl('h3', { textContent: config.title }),
        createEl('div', { id: config.listId }),
        config.formFields ? renderForm(config.formFields, {}, { id: config.formId }) : null // Render form only if formFields exist
    ].filter(Boolean))); // Filter out null if formFields is not present
    wrapper.appendChild(createEl('hr'));

    // The listRenderer logic is now directly within this function, using config.itemRenderer and config.actionsConfig
    const listRenderer = () => {
        let items;
        if (config.listId === 'rly-list') {
            items = appStore.get().relays;
        } else if (config.listId === 'followed-list') {
            items = appStore.get().followedPubkeys;
        } else if (config.listId === 'offline-queue-list') {
            // Offline queue is handled by customRenderLogic, this path should not be taken for it
            // but keeping it for consistency if it were to be rendered generically
            items = appStore.get().offlineQueue; // Assuming offlineQueue is in appStore for generic rendering
        } else {
            items = appStore.get().settings[config.listId.replace('-list', '')];
        }

        renderList(config.listId, items || [], config.itemRenderer, config.actionsConfig, config.itemWrapperClass, wrapper);
    };

    if (config.addInputId && config.addBtnId && config.addLogic) { // Only setup add/remove if relevant fields exist
        setupAddRemoveListSection({
            modalContent: wrapper,
            addInputId: config.addInputId,
            addBtnId: config.addBtnId,
            addLogic: config.addLogic,
            listRenderer: listRenderer,
            saveBtnId: config.saveBtnId,
            onSaveCallback: config.onSaveCallback
        });
    } else if (config.saveBtnId && config.onSaveCallback) { // Setup save button even if no add logic
        const saveBtn = $(`#${config.saveBtnId}`, wrapper);
        if (saveBtn) {
            saveBtn.onclick = () => {
                if (config.onSaveCallback) config.onSaveCallback();
                showToast("Settings saved.", 'success');
            };
        }
    }


    // Initial render of the list
    listRenderer();

    // Call any unique listeners setup for this section
    if (config.uniqueListenersSetup) {
        config.uniqueListenersSetup(wrapper);
    }
}

// Specific renderers for list items (used by createListSectionRenderer) - MOVED TO settingsConfig.js
// export const renderRelays = createListSectionRenderer(...);
// export const renderCategories = createListSectionRenderer(...);
// export const renderFocusTags = createListSectionRenderer(...);
// export const renderMuteList = createListSectionRenderer(...);
// export const renderFollowedList = createListSectionRenderer(...);

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
