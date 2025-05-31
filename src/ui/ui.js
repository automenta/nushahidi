import {appStore} from './store.js';
import {idSvc} from './services.js';
import {C, createEl} from './utils.js';
import {showConfirmModal, showModal, Modal} from './modals.js';
import {FilterControls, applyAllFilters} from './components/FilterControls.js';
import {ReportList} from './components/ReportList.js';
import {ConnectionStatus} from './components/ConnectionStatus.js';
import {GlobalLoadingSpinner} from './components/GlobalLoadingSpinner.js';
import {AppHeader} from './components/AppHeader.js';
import {ReportDetailsModal} from './components/ReportDetailsModal.js';
import {AuthModal} from './components/AuthModal.js';
import {ReportFormModal} from './components/ReportFormModal.js';
import {SettingsModal} from './components/SettingsModal.js';

const OnboardingModalComponent = () => {
    const onboardingModalElement = new Modal('onboarding-info', 'Welcome to NostrMapper!', (contentRoot, modalRoot) => {
        const gotItBtn = createEl('button', { textContent: 'Got It!' });
        gotItBtn.addEventListener('click', hideOnboarding);
        modalRoot.querySelector('.close-btn')?.addEventListener('click', hideOnboarding);
        return [
            createEl('p', { textContent: 'NostrMapper is a decentralized mapping application built on Nostr. Report incidents, observations, and aid requests directly to the Nostr network.' }),
            createEl('p', { textContent: 'Your reports are public and uncensorable. Connect your Nostr identity to start contributing!' }),
            gotItBtn
        ];
    });

    const hideOnboarding = () => {
        localStorage.setItem(C.ONBOARDING_KEY, 'true');
        onboardingModalElement.hide();
    };

    return onboardingModalElement;
};

export function initUI() {
    const root = document.getElementById('app');
    if (!root) return;
    root.innerHTML = '';

    const authModal = new AuthModal();
    const reportFormModal = new ReportFormModal();
    const settingsModal = new SettingsModal();
    const onboardingModal = OnboardingModalComponent();

    const appHeader = AppHeader({
        onCreateReport: () => reportFormModal.show('rep-title'),
        onAuthToggle: () => {
            appStore.get().user ?
                showConfirmModal("Logout Confirmation", "Are you sure you want to log out? Your local private key (if used) will be cleared from memory.", () => idSvc.logout()) :
                authModal.show('conn-nip07-btn');
        },
        onShowSettings: () => settingsModal.show()
    });
    const filterControls = FilterControls();
    const reportList = ReportList();
    const connectionStatus = ConnectionStatus({ onShowSettings: () => settingsModal.show() });
    const globalLoadingSpinner = GlobalLoadingSpinner();

    root.append(
        appHeader,
        filterControls,
        reportList,
        connectionStatus,
        globalLoadingSpinner
    );

    appStore.on((newState, oldState) => {
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
        if (shouldReapplyFilters) applyAllFilters();

        if (newState.ui.reportIdToView !== oldState?.ui?.reportIdToView) {
            if (newState.ui.reportIdToView) {
                const report = newState.reports.find(r => r.id === newState.ui.reportIdToView);
                if (report) {
                    const reportDetailsModal = new ReportDetailsModal(report);
                    reportDetailsModal.show('detail-title');
                }
            }
        }
    });

    applyAllFilters();
    appStore.set(s => ({ ui: { ...s.ui, showReportList: true } }));

    if (!localStorage.getItem(C.ONBOARDING_KEY)) onboardingModal.show();
}
