import { appStore } from '../store.js';
import { dbSvc } from '../services.js';
import { $, createEl, sanitizeHTML, formatNpubShort } from '../utils.js';
import { showReportDetails } from './reportDetails.js';
import { applyAllFilters } from './filters.js';
import { showModal } from './modals.js';

export const updAuthDisp = pk => {
    const authButton = $('#auth-button');
    const userPubkeySpan = $('#user-pubkey');
    if (pk) {
        authButton.textContent = 'Logout';
        userPubkeySpan.textContent = `User: ${formatNpubShort(pk)}`;
        userPubkeySpan.style.display = 'inline';
    } else {
        authButton.textContent = 'Connect Nostr';
        userPubkeySpan.style.display = 'none';
    }
};

export const updConnDisp = isOnline => {
    const connectionStatusElement = $('#connection-status');
    if (connectionStatusElement) {
        connectionStatusElement.textContent = isOnline ? 'Online' : 'Offline';
        connectionStatusElement.style.color = isOnline ? 'lightgreen' : 'lightcoral';
    }
};

export const updSyncDisp = async () => {
    const syncStatusElement = $('#sync-status');
    if (!syncStatusElement) return;
    try {
        const queue = await dbSvc.getOfflineQ();
        if (queue.length > 0) {
            syncStatusElement.textContent = `Syncing (${queue.length})...`;
            syncStatusElement.style.color = 'orange';
            syncStatusElement.disabled = false;
            syncStatusElement.onclick = () => showModal('settings-modal');
        } else {
            syncStatusElement.textContent = appStore.get().online ? 'Synced' : 'Offline';
            syncStatusElement.style.color = 'lightgreen';
            syncStatusElement.disabled = true;
            syncStatusElement.onclick = null;
        }
    } catch {
        syncStatusElement.textContent = 'Sync status err';
        syncStatusElement.style.color = 'red';
        syncStatusElement.disabled = true;
        syncStatusElement.onclick = null;
    }
};

export const handleReportAndFilterUpdates = (newState, oldState) => {
    const shouldReapplyFilters =
        newState.reports !== oldState?.reports ||
        newState.settings.mute !== oldState?.settings?.mute ||
        newState.currentFocusTag !== oldState?.currentFocusTag ||
        newState.drawnShapes !== oldState?.drawnShapes ||
        newState.ui.spatialFilterEnabled !== oldState?.ui?.spatialFilterEnabled ||
        newState.followedPubkeys !== oldState?.followedPubkeys ||
        newState.ui.followedOnlyFilter !== oldState?.ui?.followedOnlyFilter ||
        newState.ui.filters.q !== oldState?.ui?.filters?.q ||
        newState.ui.filters.cat !== oldState?.ui?.filters?.cat ||
        newState.ui.filters.auth !== oldState?.ui?.filters?.auth ||
        newState.ui.filters.tStart !== oldState?.ui?.filters?.tStart ||
        newState.ui.filters.tEnd !== oldState?.ui?.filters?.tEnd;

    if (shouldReapplyFilters) {
        if (newState.currentFocusTag !== oldState?.currentFocusTag) {
            const focusTagInput = $('#focus-tag-input', $('#filter-controls'));
            if (focusTagInput) {
                focusTagInput.value = newState.currentFocusTag;
            }
        }
        applyAllFilters();
    }
};

export const updateFilterCategories = (newCategories) => {
    const selectElement = $('#filter-category', $('#filter-controls'));
    if (selectElement) {
        selectElement.innerHTML = '<option value="">All</option>';
        newCategories.forEach(c => selectElement.appendChild(createEl('option', { value: c, textContent: sanitizeHTML(c) })));
    }
};

export const handleModalFocus = (newModalId, oldModalId) => {
    if (newModalId && newModalId !== oldModalId && $(`#${newModalId}`)) {
        $(`#${newModalId}`).focus();
    }
};

export const handleReportViewing = (reportId, reports) => {
    if (reportId) {
        const report = reports.find(r => r.id === reportId);
        if (report) showReportDetails(report);
    }
};

export const updateGlobalLoadingSpinner = (isLoading) => {
    const globalSpinner = $('#global-loading-spinner');
    if (globalSpinner) {
        globalSpinner.style.display = isLoading ? 'flex' : 'none';
    }
};
