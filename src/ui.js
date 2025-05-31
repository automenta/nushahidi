import { appStore } from './store.js';
import { idSvc } from './services.js';
import { $, C, createEl } from './utils.js';
import { hideModal, showConfirmModal, showModal, Modal } from './ui/modals.js';
import { AuthModal } from './ui/components/AuthModal.js';
import { ReportFormModal } from './ui/components/ReportFormModal.js';
import { SettingsModal } from './ui/components/SettingsModal.js';
import { FilterControls, applyAllFilters } from './ui/components/FilterControls.js';
import {
    handleModalFocus,
    handleReportAndFilterUpdates,
    handleReportViewing,
    updateAuthDisplay,
    updateConnectionDisplay,
    updateFilterCategories,
    updateGlobalLoadingSpinner,
    updateSyncDisplay
} from './ui/statusDisplays.js';

const ensureContainerExists = (id, parent = document.body) => {
    let container = $(`#${id}`);
    if (!container) {
        container = createEl('div', { id: id });
        parent.appendChild(container);
    }
    return container;
};

const setupOnboardingModal = () => {
    // Create the onboarding modal if it doesn't exist
    if (!$('#onboarding-info')) {
        Modal('onboarding-info', 'Welcome to NostrMapper!', root => [
            createEl('p', { textContent: 'NostrMapper is a decentralized mapping application built on Nostr. Report incidents, observations, and aid requests directly to the Nostr network.' }),
            createEl('p', { textContent: 'Your reports are public and uncensorable. Connect your Nostr identity to start contributing!' }),
            createEl('button', { textContent: 'Got It!' })
        ]);
    }

    const onboardingModal = $('#onboarding-info');
    if (!onboardingModal) return; // Should not happen if Modal successfully created it

    const hideOnboarding = () => {
        localStorage.setItem(C.ONBOARDING_KEY, 'true');
        hideModal('onboarding-info');
    };

    $('.close-btn', onboardingModal)?.addEventListener('click', hideOnboarding);
    $('button', onboardingModal)?.addEventListener('click', hideOnboarding);
};

export function initUI() {
    // Ensure static containers exist
    const filterControlsContainer = ensureContainerExists('filter-controls');
    const reportListContainer = ensureContainerExists('report-list-container');
    ensureContainerExists('report-list', reportListContainer); // Ensure report-list div exists inside report-list-container

    // Initialize modals - they will append themselves to document.body
    AuthModal();
    ReportFormModal();
    SettingsModal();
    // ReportDetailsModal is created dynamically in handleReportViewing

    // Render static UI components
    FilterControls(filterControlsContainer);

    // Setup global button click handlers
    $('#create-report-btn').onclick = () => showModal('report-form-modal', 'rep-title');

    $('#auth-button').onclick = () => {
        appStore.get().user ?
            showConfirmModal("Logout Confirmation", "Are you sure you want to log out? Your local private key (if used) will be cleared from memory.", () => idSvc.logout()) :
            showModal('auth-modal', 'conn-nip07-btn');
    };

    $('#settings-btn').onclick = () => showModal('settings-modal');

    // Setup AppStore listeners for dynamic UI updates
    appStore.on((newState, oldState) => {
        if (newState.user?.pk !== oldState?.user?.pk) updateAuthDisplay(newState.user?.pk);
        if (newState.online !== oldState?.online) updateConnectionDisplay(newState.online);
        if (newState.online !== oldState?.online || newState.reports !== oldState?.reports) updateSyncDisplay();
        handleReportAndFilterUpdates(newState, oldState);
        if (newState.settings.cats !== oldState?.settings?.cats) updateFilterCategories(newState.settings.cats);
        if (newState.ui.modalOpen !== oldState?.ui?.modalOpen) handleModalFocus(newState.ui.modalOpen, oldState?.ui?.modalOpen);
        if (newState.ui.reportIdToView !== oldState?.ui?.reportIdToView) handleReportViewing(newState.ui.reportIdToView, newState.reports);
        if (newState.ui.loading !== oldState?.ui?.loading) updateGlobalLoadingSpinner(newState.ui.loading);
    });

    // Initial UI updates based on current store state
    updateAuthDisplay(appStore.get().user?.pk);
    updateConnectionDisplay(appStore.get().online);
    updateGlobalLoadingSpinner(appStore.get().ui.loading);
    updateFilterCategories(appStore.get().settings.cats);
    updateSyncDisplay();
    applyAllFilters();

    // Setup and show onboarding modal if not seen before
    setupOnboardingModal();
    if (!localStorage.getItem(C.ONBOARDING_KEY)) showModal('onboarding-info');
}
