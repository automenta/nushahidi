import { appStore } from './store.js';
import { idSvc } from './services.js';
import { $, C } from './utils.js';
import { hideModal, showConfirmModal, showModal } from './ui/modals.js';
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

const setupOnboardingModal = () => {
    const onboardingModal = $('#onboarding-info');
    if (!onboardingModal) return;

    const hideOnboarding = () => {
        localStorage.setItem(C.ONBOARDING_KEY, 'true');
        hideModal('onboarding-info');
    };

    $('.close-btn', onboardingModal)?.addEventListener('click', hideOnboarding);
    $('button', onboardingModal)?.addEventListener('click', hideOnboarding);
};

export function initUI() {
    // Render main UI components once
    $('#auth-modal-container').appendChild(AuthModal());
    $('#report-form-modal').appendChild(ReportFormModal());
    $('#settings-modal-container').appendChild(SettingsModal());
    $('#filter-controls').appendChild(FilterControls()); // Append FilterControls to its container

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
    applyAllFilters(); // Apply filters initially

    // Setup and show onboarding modal if not seen before
    setupOnboardingModal();
    if (!localStorage.getItem(C.ONBOARDING_KEY)) showModal('onboarding-info');
}
