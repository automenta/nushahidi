import { appStore } from '../store.js';
import { dbSvc } from '../services.js';
import { $, createEl, sanitizeHTML, formatNpubShort } from '../utils.js';
import { showReportDetails } from './reportList.js'; // Needs showReportDetails for handleReportViewing
import { applyAllFilters } from './filters.js'; // Needs applyAllFilters

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
        } else {
            syncStatusElement.textContent = appStore.get().online ? 'Synced' : 'Offline';
            syncStatusElement.style.color = 'lightgreen';
        }
    } catch {
        syncStatusElement.textContent = 'Sync status err';
        syncStatusElement.style.color = 'red';
    }
};

// New: Handles updates related to reports and filters
export const handleReportAndFilterUpdates = (newState, oldState) => {
    const shouldReapplyFilters =
        newState.reports !== oldState?.reports ||
        newState.settings.mute !== oldState?.settings?.mute ||
        newState.currentFocusTag !== oldState?.currentFocusTag ||
        newState.drawnShapes !== oldState?.drawnShapes ||
        newState.ui.spatialFilterEnabled !== oldState?.ui?.spatialFilterEnabled ||
        newState.followedPubkeys !== oldState?.followedPubkeys ||
        newState.ui.followedOnlyFilter !== oldState?.ui?.followedOnlyFilter;

    if (shouldReapplyFilters) {
        // Update local filter state if currentFocusTag changed in appStore
        // This part needs to interact with _cFilt from filters.js.
        // To avoid circular dependency or exposing _cFilt directly,
        // I'll rely on initFilterControls to set the initial state
        // and applyAllFilters to read the appStore state.
        // The filter form's focus-tag-input should be updated directly.
        if (newState.currentFocusTag !== oldState?.currentFocusTag) {
            const focusTagInput = $('#focus-tag-input', $('#filter-controls'));
            if (focusTagInput) {
                focusTagInput.value = newState.currentFocusTag;
            }
        }
        // The followedOnlyFilter is also handled by applyAllFilters reading appStore.
        applyAllFilters();
    }
};

// New: Updates the category filter dropdown
export const updateFilterCategories = (newCategories) => {
    const selectElement = $('#filter-category', $('#filter-controls')); // Scope to filter form
    if (selectElement) {
        selectElement.innerHTML = '<option value="">All</option>'; // Clear existing options
        newCategories.forEach(c => selectElement.appendChild(createEl('option', { value: c, textContent: sanitizeHTML(c) })));
    }
};

// New: Handles modal focus when a modal opens
export const handleModalFocus = (newModalId, oldModalId) => {
    if (newModalId && newModalId !== oldModalId && $(`#${newModalId}`)) {
        $(`#${newModalId}`).focus();
    }
};

// New: Handles displaying a specific report in the detail view
export const handleReportViewing = (reportId, reports) => {
    if (reportId) {
        const report = reports.find(r => r.id === reportId);
        if (report) showReportDetails(report);
    }
};

// New: Controls the visibility of the global loading spinner
export const updateGlobalLoadingSpinner = (isLoading) => {
    const globalSpinner = $('#global-loading-spinner');
    if (globalSpinner) {
        globalSpinner.style.display = isLoading ? 'flex' : 'none';
    }
};
