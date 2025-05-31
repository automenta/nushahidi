import {appStore} from './store.js';
import {idSvc} from './services.js';
import {$, C} from './utils.js';

import {hideModal, showConfirmModal, showModal} from './ui/modals.js';
import {RepFormComp} from './ui/reportForm.js';
import {AuthModalComp} from './ui/authModal.js';
import {SettPanComp} from './ui/settingsPanel.js';
import {initFilterControls} from './ui/filters.js';
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

const initGlobalButtons = () => {
    $('#create-report-btn').onclick = () => {
        $('#report-form-modal').innerHTML = '';
        $('#report-form-modal').append(RepFormComp());
        showModal('report-form-modal', 'rep-title');
    };

    $('#auth-button').onclick = () => {
        appStore.get().user ?
            showConfirmModal("Logout Confirmation", "Are you sure you want to log out? Your local private key (if used) will be cleared from memory.", () => idSvc.logout()) :
            (() => {
                $('#auth-modal').innerHTML = '';
                $('#auth-modal').append(AuthModalComp());
                showModal('auth-modal', 'conn-nip07-btn');
            })();
    };

    $('#settings-btn').onclick = () => {
        $('#settings-modal').innerHTML = '';
        $('#settings-modal').append(SettPanComp());
        showModal('settings-modal');
    };
};

const setupAppStoreListeners = () => {
    appStore.on((newState, oldState) => {
        if (newState.user?.pk !== oldState?.user?.pk) updateAuthDisplay(newState.user?.pk);
        if (newState.online !== oldState?.online) updateConnectionDisplay(newState.online);
        if (newState.online !== oldState?.online || newState.reports !== oldState?.reports) updateSyncDisplay();
        handleReportAndFilterUpdates(newState, oldState);
        if (newState.settings.cats !== oldState?.settings?.cats) updateFilterCategories(newState.settings.cats);
        if (newState.ui.modalOpen !== oldState?.ui?.modalOpen) handleModalFocus(newState.ui.modalOpen, oldState?.ui?.modalOpen);
        if (newState.ui.viewingReport !== oldState?.ui?.viewingReport) handleReportViewing(newState.ui.viewingReport, newState.reports);
        if (newState.ui.loading !== oldState?.ui?.loading) updateGlobalLoadingSpinner(newState.ui.loading);
    });
};

export function initUI() {
    initGlobalButtons();
    initFilterControls();
    setupAppStoreListeners();
    setupOnboardingModal();

    if (!localStorage.getItem(C.ONBOARDING_KEY)) showModal('onboarding-info');
}
