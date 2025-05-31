import { appStore } from '../store.js';
import { mapSvc, idSvc, confSvc, nostrSvc, dbSvc, offSvc } from '../services.js';
import { C, $, createEl, sanitizeHTML, formatNpubShort } from '../utils.js';
import { createModalWrapper, hideModal } from './modals.js';
import { renderForm, setupAddRemoveListSection } from './forms.js';
import {
    createListSectionRenderer,
    addRelayLogic,
    addCategoryLogic,
    addFocusTagLogic,
    addMutePubkeyLogic,
    addFollowedPubkeyLogic
} from './settingsHelpers.js';

// Import modularized settings sections
import { renderKeyManagementSection } from './settings/keyManagement.js';
import { renderMapTilesSection } from './settings/mapTiles.js';
import { renderImageHostSection } from './settings/imageHost.js';
import { renderFollowedUsersSection, renderFollowedList } from './settings/followedUsers.js';
import { renderDataManagementSection } from './settings/dataManagement.js';


const renderRelays = createListSectionRenderer('rly-list',
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

const renderCategories = createListSectionRenderer('cat-list',
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

const renderFocusTags = createListSectionRenderer('focus-tag-list',
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

const renderMuteList = createListSectionRenderer('mute-list',
    pk => createEl('span', { textContent: formatNpubShort(pk) }),
    [{
        label: 'Remove',
        className: 'remove-mute-btn',
        onClick: pk => confSvc.rmMute(pk),
        confirm: { title: 'Remove Muted Pubkey', message: 'Are you sure you want to unmute this pubkey?' }
    }],
    'mute-entry'
);

const renderOfflineQueue = async (modalContent) => {
    const queueItems = await dbSvc.getOfflineQ();

    const getEventType = (kind) => {
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

    const offlineQueueItemRenderer = item => {
        const eventType = getEventType(item.event.kind);
        const timestamp = new Date(item.ts).toLocaleString();
        const contentSnippet = item.event.content.substring(0, 50) + (item.event.content.length > 50 ? '...' : '');
        const eventIdSnippet = item.event.id.substring(0, 8);
        return createEl('span', { innerHTML: `<strong>${sanitizeHTML(eventType)}</strong> (${timestamp}) - ID: ${sanitizeHTML(eventIdSnippet)}... <br>Content: <em>${sanitizeHTML(contentSnippet || 'N/A')}</em>` });
    };

    const offlineQueueActionsConfig = [
        {
            label: 'Retry',
            className: 'retry-offline-q-btn',
            onClick: async (item) => { // withLoading/withToast handled by pubEv
                await nostrSvc.pubEv(item.event);
                await dbSvc.rmOfflineQ(item.qid);
                renderOfflineQueue(modalContent); // Re-render list after action
            }
        },
        {
            label: 'Delete',
            className: 'remove-offline-q-btn',
            onClick: async (item) => { // withLoading/withToast handled by rmOfflineQ
                await dbSvc.rmOfflineQ(item.qid);
                renderOfflineQueue(modalContent); // Re-render list after action
            }
        }
    ];

    renderList('offline-queue-list', queueItems, offlineQueueItemRenderer, offlineQueueActionsConfig, 'offline-q-entry', modalContent);
};

// Helper to setup common list management sections
const setupListManagement = (modalContent, config) => {
    setupAddRemoveListSection({
        modalContent,
        addInputId: config.addInputId,
        addBtnId: config.addBtnId,
        addLogic: config.addLogic,
        listRenderer: config.listRenderer,
        saveBtnId: config.saveBtnId,
        onSaveCallback: config.onSaveCallback
    });
};

export function SettPanComp() {
    const appState = appStore.get();

    const settingsContentRenderer = (modalRoot) => {
        const settingsSectionsWrapper = createEl('div', { id: 'settings-sections' });

        // Relays Section
        settingsSectionsWrapper.appendChild(createEl('section', {}, [
            createEl('h3', { textContent: 'Relays' }),
            createEl('div', { id: 'rly-list' }),
            renderForm([
                { label: 'New Relay URL:', type: 'url', id: 'new-rly-url', name: 'newRelayUrl', placeholder: 'wss://new.relay.com' },
                { label: 'Add Relay', type: 'button', id: 'add-rly-btn', buttonType: 'button' },
                { label: 'Save & Reconnect Relays', type: 'button', id: 'save-rlys-btn', buttonType: 'button' }
            ], {}, { id: 'relay-form' })
        ]));
        settingsSectionsWrapper.appendChild(createEl('hr'));

        // Local Key Management Section
        const keyManagementSection = renderKeyManagementSection(settingsSectionsWrapper);
        if (keyManagementSection) {
            settingsSectionsWrapper.appendChild(createEl('hr'));
        }

        // Focus Tags Section
        settingsSectionsWrapper.appendChild(createEl('section', {}, [
            createEl('h3', { textContent: 'Focus Tags' }),
            createEl('div', { id: 'focus-tag-list' }),
            renderForm([
                { label: 'New Focus Tag:', type: 'text', id: 'new-focus-tag-input', name: 'newFocusTag', placeholder: '#NewFocusTag' },
                { label: 'Add Focus Tag', type: 'button', id: 'add-focus-tag-btn', buttonType: 'button' },
                { label: 'Save Focus Tags', type: 'button', id: 'save-focus-tags-btn', buttonType: 'button' }
            ], {}, { id: 'focus-tag-form' })
        ]));
        settingsSectionsWrapper.appendChild(createEl('hr'));

        // Categories Section
        settingsSectionsWrapper.appendChild(createEl('section', {}, [
            createEl('h3', { textContent: 'Categories' }),
            createEl('div', { id: 'cat-list' }),
            renderForm([
                { label: 'New Category Name:', type: 'text', id: 'new-cat-name', name: 'newCategory', placeholder: 'New Category' },
                { label: 'Add Category', type: 'button', id: 'add-cat-btn', buttonType: 'button' },
                { label: 'Save Categories', type: 'button', id: 'save-cats-btn', buttonType: 'button' }
            ], {}, { id: 'category-form' })
        ]));
        settingsSectionsWrapper.appendChild(createEl('hr'));

        // Map Tiles Section
        settingsSectionsWrapper.appendChild(createEl('section', {}, [
            createEl('h3', { textContent: 'Map Tiles' }),
            renderMapTilesSection(settingsSectionsWrapper) // Render and append directly
        ]));
        settingsSectionsWrapper.appendChild(createEl('hr'));

        // Image Host Section
        settingsSectionsWrapper.appendChild(createEl('section', {}, [
            createEl('h3', { textContent: 'Image Host' }),
            renderImageHostSection(settingsSectionsWrapper) // Render and append directly
        ]));
        settingsSectionsWrapper.appendChild(createEl('hr'));

        // Mute List Section
        settingsSectionsWrapper.appendChild(createEl('section', {}, [
            createEl('h3', { textContent: 'Mute List' }),
            createEl('div', { id: 'mute-list' }),
            renderForm([
                { label: 'New Muted Pubkey:', type: 'text', id: 'new-mute-pk-input', name: 'newMutePk', placeholder: 'npub... or hex pubkey' },
                { label: 'Add to Mute List', type: 'button', id: 'add-mute-btn', buttonType: 'button' },
                { label: 'Save Mute List', type: 'button', id: 'save-mute-list-btn', buttonType: 'button' }
            ], {}, { id: 'mute-list-form' })
        ]));
        settingsSectionsWrapper.appendChild(createEl('hr'));

        // Followed Users Section
        settingsSectionsWrapper.appendChild(createEl('section', {}, [
            createEl('h3', { textContent: 'Followed Users (NIP-02)' }),
            createEl('div', { id: 'followed-list' }),
            renderFollowedUsersSection(settingsSectionsWrapper) // Render and append directly
        ]));
        settingsSectionsWrapper.appendChild(createEl('hr'));

        // Offline Queue Section
        settingsSectionsWrapper.appendChild(createEl('section', {}, [
            createEl('h3', { textContent: 'Offline Queue' }),
            createEl('p', { textContent: 'Events waiting to be published when online.' }),
            createEl('div', { id: 'offline-queue-list' })
        ]));
        settingsSectionsWrapper.appendChild(createEl('hr'));

        // Data Management Section
        settingsSectionsWrapper.appendChild(createEl('section', {}, [
            createEl('h3', { textContent: 'Data Management' }),
            renderDataManagementSection(settingsSectionsWrapper) // Render and append directly
        ]));

        return settingsSectionsWrapper;
    };

    const modalContent = createModalWrapper('settings-modal', 'Settings', settingsContentRenderer);

    modalContent.appendChild(createEl('button', { type: 'button', class: 'secondary', textContent: 'Close', onclick: () => hideModal('settings-modal'), style: 'margin-top:1rem' }));

    // Initial rendering of lists
    renderRelays(modalContent);
    renderCategories(modalContent);
    renderFocusTags(modalContent);
    renderMuteList(modalContent);
    renderFollowedList(modalContent); // This is for the list itself, not the form
    renderOfflineQueue(modalContent);

    // Setup list management for sections that use it
    setupListManagement(modalContent, {
        addInputId: 'new-rly-url',
        addBtnId: 'add-rly-btn',
        addLogic: addRelayLogic,
        listRenderer: () => renderRelays(modalContent),
        saveBtnId: 'save-rlys-btn',
        onSaveCallback: () => {
            nostrSvc.discAllRlys();
            nostrSvc.connRlys();
        }
    });

    setupListManagement(modalContent, {
        addInputId: 'new-cat-name',
        addBtnId: 'add-cat-btn',
        addLogic: addCategoryLogic,
        listRenderer: () => renderCategories(modalContent),
        saveBtnId: 'save-cats-btn'
    });

    setupListManagement(modalContent, {
        addInputId: 'new-focus-tag-input',
        addBtnId: 'add-focus-tag-btn',
        addLogic: addFocusTagLogic,
        listRenderer: () => renderFocusTags(modalContent),
        saveBtnId: 'save-focus-tags-btn',
        onSaveCallback: () => nostrSvc.refreshSubs()
    });

    setupListManagement(modalContent, {
        addInputId: 'new-mute-pk-input',
        addBtnId: 'add-mute-btn',
        addLogic: addMutePubkeyLogic,
        listRenderer: () => renderMuteList(modalContent),
        saveBtnId: 'save-mute-list-btn'
    });

    // Note: Followed users list management is handled within its own module (followedUsers.js)
    // as it has unique import/publish buttons.

    return modalContent;
}
