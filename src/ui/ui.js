import { appStore } from '../store.js';
import { C, createEl } from '../utils.js';
import { showModal } from './modals.js';
import { AuthModal } from './components/AuthModal.js';
import { ReportFormModal } from './components/ReportFormModal.js';
import { SettingsModal } from './components/SettingsModal.js';
import { applyAllFilters } from './components/FilterControls.js';
import { handleReportAndFilterUpdates, handleReportViewing } from './statusDisplays.js';
import { AppHeader } from './components/AppHeader.js';
import { ConnectionStatus } from './components/ConnectionStatus.js';
import { GlobalLoadingSpinner } from './components/GlobalLoadingSpinner.js';
import { OnboardingModal } from './components/OnboardingModal.js';
import { ReportList } from './components/ReportList.js';
import { FilterControls } from './components/FilterControls.js'; // Explicitly import FilterControls

export function initUI() {
    const root = document.getElementById('app');
    if (!root) {
        console.error('Root element #app not found!');
        return;
    }
    root.innerHTML = ''; // Clear existing content

    // Initialize modals (they append themselves to body)
    const authModalElement = AuthModal();
    const reportFormModalElement = ReportFormModal();
    const settingsModalElement = SettingsModal();
    const onboardingModalElement = OnboardingModal();

    // Render main UI components into the root
    const header = AppHeader(reportFormModalElement, authModalElement, settingsModalElement);
    const filterControls = FilterControls();
    const reportList = ReportList();
    const connectionStatus = ConnectionStatus(settingsModalElement);
    const globalLoadingSpinner = GlobalLoadingSpinner();

    root.append(
        header,
        filterControls,
        reportList,
        connectionStatus,
        globalLoadingSpinner
    );

    // Initial state updates
    applyAllFilters();
    // Set initial state for report list visibility
    appStore.set(s => ({ ui: { ...s.ui, showReportList: true } }));


    // Global state listeners
    appStore.on((newState, oldState) => {
        handleReportAndFilterUpdates(newState, oldState);
        if (newState.ui.reportIdToView !== oldState?.ui?.reportIdToView) handleReportViewing(newState.ui.reportIdToView, newState.reports);
        // Other updates are now handled by individual components subscribing to the store
    });

    // Show onboarding modal if not seen before
    if (!localStorage.getItem(C.ONBOARDING_KEY)) {
        showModal(onboardingModalElement);
    }
}
