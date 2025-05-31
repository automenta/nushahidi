import { nip19 } from 'nostr-tools';
import { appStore } from '../store.js';
import { mapSvc, idSvc, confSvc, nostrSvc, dbSvc, offSvc } from '../services.js';
import { C, $, createEl, sanitizeHTML, formatNpubShort, npubToHex, showToast, isValidUrl } from '../utils.js';
import { createModalWrapper, showConfirmModal, showPassphraseModal, hideModal, showModal } from './modals.js';
import { renderForm, setupAddRemoveListSection, renderList } from './forms.js';

// Helper to create list rendering functions
const createListSectionRenderer = (containerId, itemRenderer, actionsConfig, itemWrapperClass) => (modalContent) => {
    renderList(containerId, appStore.get()[containerId.replace('-list', '')] || appStore.get().settings[containerId.replace('-list', '')], itemRenderer, actionsConfig, itemWrapperClass, modalContent);
};

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

const renderFollowedList = createListSectionRenderer('followed-list',
    f => createEl('span', { textContent: formatNpubShort(f.pk) }),
    [{
        label: 'Unfollow',
        className: 'remove-followed-btn',
        onClick: f => confSvc.rmFollowed(f.pk),
        confirm: { title: 'Unfollow User', message: 'Are you sure you want to unfollow this user?' }
    }],
    'followed-entry'
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
            onClick: async (item) => {
                appStore.set(s => ({ ui: { ...s.ui, loading: true } }));
                try {
                    await nostrSvc.pubEv(item.event);
                    await dbSvc.rmOfflineQ(item.qid);
                    showToast("Event retried and published!", 'success');
                } catch (e) {
                    showToast(`Failed to retry event: ${e.message}`, 'error');
                } finally {
                    appStore.set(s => ({ ui: { ...s.ui, loading: false } }));
                    renderOfflineQueue(modalContent);
                }
            }
        },
        {
            label: 'Delete',
            className: 'remove-offline-q-btn',
            onClick: async (item) => {
                appStore.set(s => ({ ui: { ...s.ui, loading: true } }));
                try {
                    await dbSvc.rmOfflineQ(item.qid);
                    showToast("Event removed from queue.", 'info');
                } catch (e) {
                    showToast(`Failed to delete event from queue: ${e.message}`, 'error');
                } finally {
                    appStore.set(s => ({ ui: { ...s.ui, loading: false } }));
                    renderOfflineQueue(modalContent);
                }
            },
            confirm: { title: 'Delete Queued Event', message: 'Are you sure you want to delete this event from the offline queue? It will NOT be published.' }
        }
    ];

    renderList('offline-queue-list', queueItems, offlineQueueItemRenderer, offlineQueueActionsConfig, 'offline-q-entry', modalContent);
};


const addRelayLogic = async (url) => {
    if (!isValidUrl(url)) {
        showToast("Invalid URL.", 'warning');
        return false;
    }
    const currentRelays = appStore.get().relays;
    if (currentRelays.some(r => r.url === url)) {
        showToast("Relay already exists.", 'info');
        return false;
    }
    confSvc.setRlys([...currentRelays, { url, read: true, write: true, status: '?' }]);
    showToast("Relay added.", 'success');
    return true;
};

const addCategoryLogic = async (cat) => {
    const currentCats = appStore.get().settings.cats;
    if (currentCats.includes(cat)) {
        showToast("Category already exists.", 'info');
        return false;
    }
    confSvc.setCats([...currentCats, cat]);
    showToast("Category added.", 'success');
    return true;
};

const addFocusTagLogic = async (tag) => {
    if (!tag.startsWith('#')) tag = '#' + tag;
    const currentTags = appStore.get().focusTags;
    if (currentTags.some(t => t.tag === tag)) {
        showToast("Focus tag already exists.", 'info');
        return false;
    }
    confSvc.setFocusTags([...currentTags, { tag, active: false }]);
    showToast("Focus tag added.", 'success');
    return true;
};

const addMutePubkeyLogic = async (pk) => {
    try {
        pk = npubToHex(pk);
        confSvc.addMute(pk);
        return true;
    } catch (e) {
        showToast(`Error adding pubkey: ${e.message}`, 'error');
        return false;
    }
};

const addFollowedPubkeyLogic = async (pk) => {
    try {
        pk = npubToHex(pk);
        confSvc.addFollowed(pk);
        return true;
    } catch (e) {
        showToast(`Error adding user: ${e.message}`, 'error');
        return false;
    }
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

const setupKeyManagementListeners = (modalContent) => {
    const expSkBtn = $('#exp-sk-btn', modalContent);
    if (expSkBtn) {
        expSkBtn.onclick = async () => {
            if (!appStore.get().user) return showToast("No Nostr identity connected.", 'warning');
            if (appStore.get().user.authM === 'nip07') return showToast("NIP-07 keys cannot be exported.", 'info');

            appStore.set(s => ({ ui: { ...s.ui, loading: true } }));
            try {
                const sk = await idSvc.getSk(true);
                if (sk) {
                    showToast(
                        "Your private key (nsec) is displayed below. Copy it NOW and store it securely. DO NOT share it.",
                        'critical-warning',
                        0,
                        nip19.nsecEncode(sk)
                    );
                }
            } catch (e) {
                showToast(`Export failed: ${e.message}`, 'error');
            } finally {
                appStore.set(s => ({ ui: { ...s.ui, loading: false } }));
            }
        };
    }

    const chgPassBtn = $('#chg-pass-btn', modalContent);
    if (chgPassBtn) {
        chgPassBtn.onclick = async () => {
            const oldPass = $('#chg-pass-old', modalContent).value;
            const newPass = $('#chg-pass-new', modalContent).value;
            if (!oldPass || !newPass || newPass.length < 8) {
                return showToast("Both passphrases are required, new must be min 8 chars.", 'warning');
            }
            appStore.set(s => ({ ui: { ...s.ui, loading: true } }));
            try {
                await idSvc.chgPass(oldPass, newPass);
                $('#chg-pass-old', modalContent).value = '';
                $('#chg-pass-new', modalContent).value = '';
            } catch (e) {
                showToast(`Passphrase change failed: ${e.message}`, 'error');
            } finally {
                appStore.set(s => ({ ui: { ...s.ui, loading: false } }));
            }
        };
    }
};

const setupMapTilesListeners = (modalContent) => {
    const tilePresetSel = $('#tile-preset-sel', modalContent);
    const tileUrlIn = $('#tile-url-in', modalContent);
    const appState = appStore.get();

    tilePresetSel.value = appState.settings.tilePreset;

    tilePresetSel.onchange = () => {
        const selectedPreset = C.TILE_SERVERS_PREDEFINED.find(p => p.name === tilePresetSel.value);
        if (selectedPreset) {
            tileUrlIn.value = selectedPreset.url;
        } else {
            tileUrlIn.value = '';
        }
    };

    $('#save-tile-btn', modalContent).onclick = () => {
        const selectedPresetName = tilePresetSel.value;
        const customUrl = tileUrlIn.value.trim();

        if (!isValidUrl(customUrl)) {
            return showToast("Invalid tile URL.", 'warning');
        }

        confSvc.setTilePreset(selectedPresetName, customUrl);
        mapSvc.updTile(customUrl);
        showToast("Map tile settings saved.", 'success');
    };
};

const setupImageHostListeners = (modalContent) => {
    const imgHostSel = $('#img-host-sel', modalContent);
    const nip96Fields = $('#nip96-fields', modalContent);
    const nip96UrlIn = $('#nip96-url-in', modalContent);
    const nip96TokenIn = $('#nip96-token-in', modalContent);
    const appState = appStore.get();

    if (appState.settings.nip96Host) {
        imgHostSel.value = 'nip96';
        nip96Fields.style.display = '';
    } else {
        imgHostSel.value = appState.settings.imgHost || C.IMG_UPLOAD_NOSTR_BUILD;
        nip96Fields.style.display = 'none';
    }

    imgHostSel.onchange = () => {
        if (imgHostSel.value === 'nip96') {
            nip96Fields.style.display = '';
        } else {
            nip96Fields.style.display = 'none';
        }
    };

    $('#save-img-host-btn', modalContent).onclick = () => {
        const selectedHost = imgHostSel.value;
        if (selectedHost === 'nip96') {
            const nip96Url = nip96UrlIn.value.trim();
            const nip96Token = nip96TokenIn.value.trim();
            if (!isValidUrl(nip96Url)) {
                return showToast("Invalid NIP-96 server URL.", 'warning');
            }
            confSvc.setImgHost(nip96Url, true, nip96Token);
        } else {
            confSvc.setImgHost(selectedHost, false);
        }
        showToast("Image host settings saved.", 'success');
    };
};

const setupFollowedListUniqueListeners = (modalContent) => {
    $('#import-contacts-btn', modalContent).onclick = async () => {
        if (!appStore.get().user) {
            showToast("Please connect your Nostr identity to import contacts.", 'warning');
            return;
        }
        appStore.set(s => ({ ui: { ...s.ui, loading: true } }));
        try {
            const contacts = await nostrSvc.fetchContacts();
            if (contacts.length > 0) {
                const currentFollowed = appStore.get().followedPubkeys.map(f => f.pk);
                const newFollowed = contacts.filter(c => !currentFollowed.includes(c.pubkey)).map(c => ({ pk: c.pubkey, followedAt: Date.now() }));
                if (newFollowed.length > 0) {
                    confSvc.setFollowedPubkeys([...appStore.get().followedPubkeys, ...newFollowed]);
                    showToast(`Imported ${newFollowed.length} contacts from Nostr.`, 'success');
                } else {
                    showToast("No new contacts found to import.", 'info');
                }
            } else {
                showToast("No NIP-02 contact list found on relays for your account.", 'info');
            }
        } catch (e) {
            showToast(`Error importing contacts: ${e.message}`, 'error');
        } finally {
            appStore.set(s => ({ ui: { ...s.ui, loading: false } }));
        }
    };

    $('#publish-contacts-btn', modalContent).onclick = async () => {
        if (!appStore.get().user) {
            showToast("Please connect your Nostr identity to publish contacts.", 'warning');
            return;
        }
        showConfirmModal(
            "Publish Contacts",
            "This will publish your current followed list as a NIP-02 contact list (Kind 3 event) to your connected relays. This will overwrite any existing Kind 3 event for your pubkey. Continue?",
            async () => {
                appStore.set(s => ({ ui: { ...s.ui, loading: true } }));
                try {
                    const contactsToPublish = appStore.get().followedPubkeys.map(f => ({ pubkey: f.pk, relay: '', petname: '' }));
                    await nostrSvc.pubContacts(contactsToPublish);
                    showToast("NIP-02 contact list published!", 'success');
                } catch (e) {
                    showToast(`Error publishing contacts: ${e.message}`, 'error');
                } finally {
                    appStore.set(s => ({ ui: { ...s.ui, loading: false } }));
                }
            },
            () => showToast("Publish contacts cancelled.", 'info')
        );
    };
};

const setupDataManagementListeners = (modalContent) => {
    $('#clr-reps-btn', modalContent).onclick = () => {
        showConfirmModal(
            "Clear Cached Reports",
            "Are you sure you want to clear all cached reports from your local database? This will not delete them from relays.",
            async () => {
                appStore.set(s => ({ ui: { ...s.ui, loading: true } }));
                try {
                    await dbSvc.clearReps();
                    appStore.set({ reports: [] });
                    showToast("Cached reports cleared.", 'info');
                } catch (e) {
                    showToast(`Error clearing reports: ${e.message}`, 'error');
                } finally {
                    appStore.set(s => ({ ui: { ...s.ui, loading: false } }));
                }
            },
            () => showToast("Clearing reports cancelled.", 'info')
        );
    };

    $('#exp-setts-btn', modalContent).onclick = async () => {
        appStore.set(s => ({ ui: { ...s.ui, loading: true } }));
        try {
            const settings = await dbSvc.loadSetts();
            const followedPubkeys = await dbSvc.getFollowedPubkeys();
            const exportData = { settings, followedPubkeys };
            const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(exportData, null, 2));
            const downloadAnchorNode = document.createElement('a');
            downloadAnchorNode.setAttribute("href", dataStr);
            downloadAnchorNode.setAttribute("download", "nostrmapper_settings.json");
            document.body.appendChild(downloadAnchorNode);
            downloadAnchorNode.click();
            downloadAnchorNode.remove();
            showToast("Settings exported.", 'success');
        } catch (e) {
            showToast(`Error exporting settings: ${e.message}`, 'error');
        } finally {
            appStore.set(s => ({ ui: { ...s.ui, loading: false } }));
        }
    };

    $('#imp-setts-file', modalContent).onchange = async e => {
        const file = e.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = async (event) => {
            try {
                const importedData = JSON.parse(event.target.result);
                if (!importedData.settings || !importedData.followedPubkeys) {
                    throw new Error("Invalid settings file format.");
                }

                showConfirmModal(
                    "Import Settings",
                    "Are you sure you want to import settings? This will overwrite your current settings and followed users.",
                    async () => {
                        appStore.set(s => ({ ui: { ...s.ui, loading: true } }));
                        try {
                            await dbSvc.saveSetts(importedData.settings);
                            await dbSvc.clearFollowedPubkeys();
                            for (const fp of importedData.followedPubkeys) {
                                await dbSvc.addFollowedPubkey(fp.pk);
                            }
                            await confSvc.load();
                            showToast("Settings imported successfully! Please refresh the page.", 'success', 5000);
                            setTimeout(() => {
                                if (confirm("Settings imported. Reload page now?")) {
                                    window.location.reload();
                                }
                            }, 2000);
                        } catch (err) {
                            showToast(`Error importing settings: ${err.message}`, 'error');
                        } finally {
                            appStore.set(s => ({ ui: { ...s.ui, loading: false } }));
                        }
                    },
                    () => showToast("Import cancelled.", 'info')
                );
            } catch (err) {
                showToast(`Failed to parse settings file: ${err.message}`, 'error');
            }
        };
        reader.readAsText(file);
    };
};

export function SettPanComp() {
    const appState = appStore.get();

    const settingsContentRenderer = (modalRoot) => {
        const settingsSectionsWrapper = createEl('div', { id: 'settings-sections' });

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

        if (appState.user && (appState.user.authM === 'local' || appState.user.authM === 'import')) {
            settingsSectionsWrapper.appendChild(createEl('section', {}, [
                createEl('h3', { textContent: 'Local Key Management' }),
                renderForm([
                    { type: 'button', id: 'exp-sk-btn', label: 'Export Private Key' },
                    { label: 'Old Passphrase:', type: 'password', id: 'chg-pass-old', name: 'oldPassphrase' },
                    { label: 'New Passphrase:', type: 'password', id: 'chg-pass-new', name: 'newPassphrase' },
                    { type: 'button', id: 'chg-pass-btn', label: 'Change Passphrase' }
                ], {}, { id: 'key-management-form' })
            ]));
            settingsSectionsWrapper.appendChild(createEl('hr'));
        }

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

        settingsSectionsWrapper.appendChild(createEl('section', {}, [
            createEl('h3', { textContent: 'Map Tiles' }),
            renderForm([
                {
                    label: 'Tile Server Preset:',
                    type: 'select',
                    id: 'tile-preset-sel',
                    name: 'tilePreset',
                    value: appState.settings.tilePreset,
                    options: C.TILE_SERVERS_PREDEFINED.map(p => ({ value: p.name, label: p.name }))
                },
                { label: 'Custom Tile URL Template:', type: 'url', id: 'tile-url-in', name: 'tileUrl', value: appState.settings.tileUrl },
                { label: 'Save Tiles', type: 'button', id: 'save-tile-btn', buttonType: 'button' }
            ], {}, { id: 'map-tiles-form' })
        ]));
        settingsSectionsWrapper.appendChild(createEl('hr'));

        settingsSectionsWrapper.appendChild(createEl('section', {}, [
            createEl('h3', { textContent: 'Image Host' }),
            renderForm([
                {
                    label: 'Provider:',
                    type: 'select',
                    id: 'img-host-sel',
                    name: 'imgHostProvider',
                    value: appState.settings.nip96Host ? 'nip96' : (appState.settings.imgHost || C.IMG_UPLOAD_NOSTR_BUILD),
                    options: [
                        { value: C.IMG_UPLOAD_NOSTR_BUILD, label: 'nostr.build (Default)' },
                        { value: 'nip96', label: 'NIP-96 Server' }
                    ]
                },
                {
                    type: 'custom-html',
                    id: 'nip96-fields',
                    class: 'nip96-fields',
                    content: [
                        createEl('label', { for: 'nip96-url-in', textContent: 'NIP-96 Server URL:' }),
                        createEl('input', { type: 'url', id: 'nip96-url-in', name: 'nip96Url', value: appState.settings.nip96Host, placeholder: 'https://your.nip96.server' }),
                        createEl('label', { for: 'nip96-token-in', textContent: 'NIP-96 Auth Token (Optional):' }),
                        createEl('input', { type: 'text', id: 'nip96-token-in', name: 'nip96Token', value: appState.settings.nip96Token })
                    ]
                }
            ], {}, { id: 'image-host-form' }),
            createEl('button', { type: 'button', id: 'save-img-host-btn', textContent: 'Save Image Host' })
        ]));
        settingsSectionsWrapper.appendChild(createEl('hr'));

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

        settingsSectionsWrapper.appendChild(createEl('section', {}, [
            createEl('h3', { textContent: 'Followed Users (NIP-02)' }),
            createEl('div', { id: 'followed-list' }),
            renderForm([
                { label: 'New Followed Pubkey:', type: 'text', id: 'new-followed-pk-input', name: 'newFollowedPk', placeholder: 'npub... or hex pubkey' },
                { label: 'Add to Followed', type: 'button', id: 'add-followed-btn', buttonType: 'button' },
                { label: 'Save Followed List', type: 'button', id: 'save-followed-btn', buttonType: 'button' },
                { type: 'hr' },
                { label: 'Import NIP-02 Contacts', type: 'button', id: 'import-contacts-btn', buttonType: 'button' },
                { label: 'Publish NIP-02 Contacts', type: 'button', id: 'publish-contacts-btn', buttonType: 'button' }
            ], {}, { id: 'followed-list-form' })
        ]));
        settingsSectionsWrapper.appendChild(createEl('hr'));

        settingsSectionsWrapper.appendChild(createEl('section', {}, [
            createEl('h3', { textContent: 'Offline Queue' }),
            createEl('p', { textContent: 'Events waiting to be published when online.' }),
            createEl('div', { id: 'offline-queue-list' })
        ]));
        settingsSectionsWrapper.appendChild(createEl('hr'));

        settingsSectionsWrapper.appendChild(createEl('section', {}, [
            createEl('h3', { textContent: 'Data Management' }),
            renderForm([
                { type: 'button', id: 'clr-reps-btn', label: 'Clear Cached Reports' },
                { type: 'button', id: 'exp-setts-btn', label: 'Export Settings' },
                { label: 'Import Settings:', type: 'file', id: 'imp-setts-file', name: 'importSettingsFile', accept: '.json' }
            ], {}, { id: 'data-management-form' })
        ]));

        return settingsSectionsWrapper;
    };

    const modalContent = createModalWrapper('settings-modal', 'Settings', settingsContentRenderer);

    modalContent.appendChild(createEl('button', { type: 'button', class: 'secondary', textContent: 'Close', onclick: () => hideModal('settings-modal'), style: 'margin-top:1rem' }));

    renderRelays(modalContent);
    renderCategories(modalContent);
    renderFocusTags(modalContent);
    renderMuteList(modalContent);
    renderFollowedList(modalContent);
    renderOfflineQueue(modalContent);

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

    setupListManagement(modalContent, {
        addInputId: 'new-followed-pk-input',
        addBtnId: 'add-followed-btn',
        addLogic: addFollowedPubkeyLogic,
        listRenderer: () => renderFollowedList(modalContent),
        saveBtnId: 'save-followed-btn'
    });

    setupKeyManagementListeners(modalContent);
    setupMapTilesListeners(modalContent);
    setupImageHostListeners(modalContent);
    setupFollowedListUniqueListeners(modalContent);
    setupDataManagementListeners(modalContent);

    return modalContent;
}
