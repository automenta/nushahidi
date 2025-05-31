import {appStore} from '../store.js';
import {dbSvc} from '../services.js';
import {$, createEl, formatNpubShort, sanitizeHTML} from '../utils.js';
import {ReportDetailsModal} from './components/ReportDetailsModal.js';
import {applyAllFilters} from './components/FilterControls.js';
import {showModal} from './modals.js';

export const updateAuthDisplay = pk => {
    const authButton = $('#auth-button');
    const userPubkeySpan = $('#user-pubkey');
    authButton.textContent = pk ? 'Logout' : 'Connect Nostr';
    userPubkeySpan.textContent = pk ? `User: ${formatNpubShort(pk)}` : '';
    userPubkeySpan.style.display = pk ? 'inline' : 'none';
};

export const updateConnectionDisplay = isOnline => {
    const connectionStatusElement = $('#connection-status');
    if (!connectionStatusElement) return;
    connectionStatusElement.textContent = isOnline ? 'Online' : 'Offline';
    connectionStatusElement.style.color = isOnline ? 'lightgreen' : 'lightcoral';
};

export const updateSyncDisplay = async () => {
    const syncStatusElement = $('#sync-status');
    if (!syncStatusElement) return;
    try {
        const queue = await dbSvc.getOfflineQ();
        if (queue.length) {
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
    const filterDependencies = [
        'reports', 'settings.mute', 'currentFocusTag', 'drawnShapes', 'ui.spatialFilterEnabled',
        'followedPubkeys', 'ui.followedOnlyFilter', 'ui.filters.q', 'ui.filters.cat',
        'ui.filters.auth', 'ui.filters.tStart', 'ui.filters.tEnd'
    ];

    const shouldReapplyFilters = filterDependencies.some(path => {
        const newVal = path.split('.').reduce((o, i) => o?.[i], newState);
        const oldVal = path.split('.').reduce((o, i) => o?.[i], oldState);
        return newVal !== oldVal;
    });

    if (shouldReapplyFilters) {
        const focusTagInput = $('#focus-tag-input', $('#filter-controls'));
        if (focusTagInput) focusTagInput.value = newState.currentFocusTag;
        applyAllFilters();
    }
};

export const updateFilterCategories = newCategories => {
    const selectElement = $('#filter-category', $('#filter-controls'));
    if (!selectElement) return;
    selectElement.innerHTML = '<option value="">All</option>';
    newCategories.forEach(c => selectElement.appendChild(createEl('option', { value: c, textContent: sanitizeHTML(c) })));
};

export const handleModalFocus = (newModalId, oldModalId) => {
    if (newModalId && newModalId !== oldModalId) $(`#${newModalId}`)?.focus();
};

export const handleReportViewing = (reportId, reports) => {
    if (reportId) {
        const report = reports.find(r => r.id === reportId);
        if (report) {
            const detailModal = ReportDetailsModal(report);
            $('#report-detail-container').innerHTML = '';
            $('#report-detail-container').appendChild(detailModal);
            showModal('report-detail-container', 'detail-title');
        }
    }
};

export const updateGlobalLoadingSpinner = isLoading => {
    const globalSpinner = $('#global-loading-spinner');
    if (globalSpinner) globalSpinner.style.display = isLoading ? 'flex' : 'none';
};
