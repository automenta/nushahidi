import { appStore } from './store.js';
import { mapSvc, idSvc, confSvc, nostrSvc, dbSvc } from './services.js';
import { C, $ } from './utils.js'; // Keep general utilities from utils.js

// Import UI components and helpers
import { showModal, hideModal, showConfirmModal } from './ui/modals.js';
import { RepFormComp } from './ui/reportForm.js';
import { AuthModalComp } from './ui/authModal.js';
import { SettPanComp } from './ui/settingsPanel.js';
import { initFilterControls } from './ui/filters.js';
import {
    updAuthDisp,
    updConnDisp,
    updSyncDisp,
    handleReportAndFilterUpdates,
    updateFilterCategories,
    handleModalFocus,
    handleReportViewing,
    updateGlobalLoadingSpinner
} from './ui/statusDisplays.js';

// --- Init UI ---
export function initUI() {
    // Setup global button listeners
    const initGlobalButtons = () => {
        $('#create-report-btn').onclick = () => {
            $('#report-form-modal').innerHTML = '';
            $('#report-form-modal').appendChild(RepFormComp()); // No report passed for new creation
            showModal('report-form-modal', 'rep-title');
        };

        $('#auth-button').onclick = () => {
            if (appStore.get().user) {
                showConfirmModal(
                    "Logout Confirmation",
                    "Are you sure you want to log out? Your local private key (if used) will be cleared from memory.",
                    () => idSvc.logout(),
                    () => {} // No toast needed, idSvc.logout() already shows one
                );
            } else {
                $('#auth-modal').innerHTML = '';
                $('#auth-modal').appendChild(AuthModalComp());
                showModal('auth-modal', 'conn-nip07-btn');
            }
        };

        $('#settings-btn').onclick = () => {
            $('#settings-modal').innerHTML = '';
            $('#settings-modal').appendChild(SettPanComp());
            showModal('settings-modal');
        };
    };

    // Setup appStore listeners for UI updates
    const setupAppStoreListeners = () => {
        appStore.on((newState, oldState) => {
            // Update authentication display
            if (newState.user?.pk !== oldState?.user?.pk) {
                updAuthDisp(newState.user?.pk);
            }

            // Update connection status display
            if (newState.online !== oldState?.online) {
                updConnDisp(newState.online);
            }

            // Update sync status display (call if online status changes or reports might have changed queue)
            if (newState.online !== oldState?.online || newState.reports !== oldState?.reports) {
                updSyncDisp();
            }

            // Handle updates related to reports and filters
            handleReportAndFilterUpdates(newState, oldState);

            // Re-populate categories if settings change
            if (newState.settings.cats !== oldState?.settings?.cats) {
                updateFilterCategories(newState.settings.cats);
            }

            // Handle modal focus
            if (newState.ui.modalOpen !== oldState?.ui?.modalOpen) {
                handleModalFocus(newState.ui.modalOpen, oldState?.ui?.modalOpen);
            }

            // Handle viewing a specific report
            if (newState.ui.viewingReport !== oldState?.ui?.viewingReport) {
                handleReportViewing(newState.ui.viewingReport, newState.reports);
            }

            // Global Loading Spinner visibility
            if (newState.ui.loading !== oldState?.ui?.loading) {
                updateGlobalLoadingSpinner(newState.ui.loading);
            }
        });
    };

    // Execute initialization functions
    initGlobalButtons();
    initFilterControls(); // This function is now imported from filters.js
    setupAppStoreListeners();

    // Onboarding check
    if (!localStorage.getItem(C.ONBOARDING_KEY)) {
        showModal('onboarding-info');
    }
} // End initUI
