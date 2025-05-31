import { appStore } from './store.js';
import { idSvc } from './services.js';
import { $, C, createEl } from './utils.js';
import { hideModal, showConfirmModal, showModal, Modal } from './ui/modals.js';
import { AuthModal } from './ui/components/AuthModal.js';
import { ReportFormModal } from './ui/components/ReportFormModal.js';
import { SettingsModal } from './ui/components/SettingsModal.js';
import { FilterControls, applyAllFilters } from './ui/components/FilterControls.js';
import {
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
    let onboardingModalElement = $('#onboarding-info');
    if (!onboardingModalElement) {
        onboardingModalElement = Modal('onboarding-info', 'Welcome to NostrMapper!', root => [
            createEl('p', { textContent: 'NostrMapper is a decentralized mapping application built on Nostr. Report incidents, observations, and aid requests directly to the Nostr network.' }),
            createEl('p', { textContent: 'Your reports are public and uncensorable. Connect your Nostr identity to start contributing!' }),
            createEl('button', { textContent: 'Got It!' })
        ]);
    }

    const hideOnboarding = () => {
        localStorage.setItem(C.ONBOARDING_KEY, 'true');
        hideModal(onboardingModalElement);
    };

    $('.close-btn', onboardingModalElement)?.addEventListener('click', hideOnboarding);
    $('button', onboardingModalElement)?.addEventListener('click', hideOnboarding);

    return onboardingModalElement;
};

export function initUI() {
    const filterControlsContainer = ensureContainerExists('filter-controls');
    const reportListContainer = ensureContainerExists('report-list-container');
    ensureContainerExists('report-list', reportListContainer);

    const authModalElement = AuthModal();
    const reportFormModalElement = ReportFormModal();
    const settingsModalElement = SettingsModal();

    FilterControls(filterControlsContainer);

    $('#create-report-btn').onclick = () => showModal(reportFormModalElement, 'rep-title');

    $('#auth-button').onclick = () => {
        appStore.get().user ?
            showConfirmModal("Logout Confirmation", "Are you sure you want to log out? Your local private key (if used) will be cleared from memory.", () => idSvc.logout()) :
            showModal(authModalElement, 'conn-nip07-btn');
    };

    $('#settings-btn').onclick = () => showModal(settingsModalElement);

    appStore.on((newState, oldState) => {
        if (newState.user?.pk !== oldState?.user?.pk) updateAuthDisplay(newState.user?.pk);
        if (newState.online !== oldState?.online) updateConnectionDisplay(newState.online);
        if (newState.online !== oldState?.online || newState.reports !== oldState?.reports) updateSyncDisplay(settingsModalElement);
        handleReportAndFilterUpdates(newState, oldState);
        if (newState.settings?.cats !== oldState?.settings?.cats) updateFilterCategories(newState.settings?.cats);
        if (newState.ui.reportIdToView !== oldState?.ui?.reportIdToView) handleReportViewing(newState.ui.reportIdToView, newState.reports);
        if (newState.ui.loading !== oldState?.ui?.loading) updateGlobalLoadingSpinner(newState.ui.loading);
    });

    updateAuthDisplay(appStore.get().user?.pk);
    updateConnectionDisplay(appStore.get().online);
    updateGlobalLoadingSpinner(appStore.get().ui.loading);
    updateFilterCategories(appStore.get().settings?.cats);
    updateSyncDisplay(settingsModalElement);
    applyAllFilters();

    const onboardingModalElement = setupOnboardingModal();
    if (!localStorage.getItem(C.ONBOARDING_KEY)) showModal(onboardingModalElement);
}
