import { appStore } from '../store.js';
import { idSvc, confSvc, nostrSvc, dbSvc, offSvc } from '../services.js';
import { C, $, createEl, sanitizeHTML, formatNpubShort } from '../utils.js';
import { createModalWrapper, hideModal } from './modals.js';
import { renderForm } from './forms.js';

import { renderKeyManagementSection } from './settings/keyManagement.js';
import { renderMapTilesSection } from './settings/mapTiles.js';
import { renderImageHostSection } from './settings/imageHost.js';
import { setupFollowedListUniqueListeners } from './settings/followedUsers.js'; // Keep this for unique listeners
import { renderDataManagementSection } from './settings/dataManagement.js';

// Import the new generalized rendering function and specific list renderers/logic
import {
    renderConfigurableListSetting,
    renderRelays, // Still needed for initial render of the list
    renderCategories, // Still needed for initial render of the list
    renderFocusTags, // Still needed for initial render of the list
    renderMuteList, // Still needed for initial render of the list
    renderFollowedList, // Still needed for initial render of the list
    renderOfflineQueue, // Still needed for initial render of the list
    offlineQueueItemRenderer, // Still needed for offline queue
    offlineQueueActionsConfig, // Still needed for offline queue
    addRelayLogic,
    addCategoryLogic,
    addFocusTagLogic,
    addMutePubkeyLogic,
    addFollowedPubkeyLogic
} from './settingsUtils.js';


const settingsContentRenderer = (modalRoot) => {
    const settingsSectionsWrapper = createEl('div', { id: 'settings-sections' });

    // Relays Section
    renderConfigurableListSetting(settingsSectionsWrapper, {
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
                nostrSvc.discAllRlys();
                nostrSvc.connRlys();
            },
            confirm: { title: 'Remove Relay', message: 'Are you sure you want to remove this relay?' }
        }],
        itemWrapperClass: 'relay-entry',
        saveBtnId: 'save-rlys-btn',
        onSaveCallback: () => {
            nostrSvc.discAllRlys();
            nostrSvc.connRlys();
        }
    });

    // Key Management Section (not a list, so rendered separately)
    const keyManagementSection = renderKeyManagementSection(settingsSectionsWrapper);
    if (keyManagementSection) {
        settingsSectionsWrapper.appendChild(createEl('hr'));
    }

    // Focus Tags Section
    renderConfigurableListSetting(settingsSectionsWrapper, {
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
        itemRenderer: ft => {
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
        actionsConfig: [{
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
        itemWrapperClass: 'focus-tag-entry',
        saveBtnId: 'save-focus-tags-btn',
        onSaveCallback: () => nostrSvc.refreshSubs()
    });

    // Categories Section
    renderConfigurableListSetting(settingsSectionsWrapper, {
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
            onClick: c => {
                const updatedCats = appStore.get().settings.cats.filter(cat => cat !== c);
                confSvc.setCats(updatedCats);
            },
            confirm: { title: 'Remove Category', message: 'Are you sure you want to remove this category?' }
        }],
        itemWrapperClass: 'category-entry',
        saveBtnId: 'save-cats-btn'
    });

    // Map Tiles Section (not a list, so rendered separately)
    settingsSectionsWrapper.appendChild(createEl('section', {}, [
        createEl('h3', { textContent: 'Map Tiles' }),
        renderMapTilesSection(settingsSectionsWrapper)
    ]));
    settingsSectionsWrapper.appendChild(createEl('hr'));

    // Image Host Section (not a list, so rendered separately)
    settingsSectionsWrapper.appendChild(createEl('section', {}, [
        createEl('h3', { textContent: 'Image Host' }),
        renderImageHostSection(settingsSectionsWrapper)
    ]));
    settingsSectionsWrapper.appendChild(createEl('hr'));

    // Mute List Section
    renderConfigurableListSetting(settingsSectionsWrapper, {
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
    });

    // Followed Users Section
    renderConfigurableListSetting(settingsSectionsWrapper, {
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
        uniqueListenersSetup: setupFollowedListUniqueListeners // This function handles the import/publish buttons
    });

    // Offline Queue Section (special case, as it's not about adding/removing via form, but displaying queue)
    settingsSectionsWrapper.appendChild(createEl('section', {}, [
        createEl('h3', { textContent: 'Offline Queue' }),
        createEl('p', { textContent: 'Events waiting to be published when online.' }),
        createEl('div', { id: 'offline-queue-list' })
    ]));
    settingsSectionsWrapper.appendChild(createEl('hr'));
    // Initial render for offline queue, and it needs to be re-rendered on updates
    renderOfflineQueue(settingsSectionsWrapper);


    // Data Management Section (not a list, so rendered separately)
    settingsSectionsWrapper.appendChild(createEl('section', {}, [
        createEl('h3', { textContent: 'Data Management' }),
        renderDataManagementSection(settingsSectionsWrapper)
    ]));

    return settingsSectionsWrapper;
};

export function SettPanComp() {
    const modalContent = createModalWrapper('settings-modal', 'Settings', settingsContentRenderer);

    modalContent.appendChild(createEl('button', { type: 'button', class: 'secondary', textContent: 'Close', onclick: () => hideModal('settings-modal'), style: 'margin-top:1rem' }));

    return modalContent;
}
