import {appStore} from '../store.js';
import {idSvc} from '../services.js';
import {C, createEl} from '../utils.js';
import {showConfirmModal} from './modals.js';
import {FilterControls, applyAllFilters} from './components/FilterControls.js';
import {ReportList} from './components/ReportList.js';
import {GlobalLoadingSpinner} from './components/GlobalLoadingSpinner.js';
import {AppHeader} from './components/AppHeader.js';
import {ReportDetailsModal} from './components/ReportDetailsModal.js';
import {AuthModal} from './components/AuthModal.js';
import {ReportFormModal} from './components/ReportFormModal.js';
import {SettingsModal} from './components/SettingsModal.js';
import {OnboardingModal} from './components/OnboardingModal.js';

export class App {
    constructor() {
        this.root = document.getElementById('app');
        if (!this.root) throw new Error("App root element not found!");
        this.root.innerHTML = '';

        this.authModal = new AuthModal();
        this.reportFormModal = new ReportFormModal();
        this.settingsModal = new SettingsModal();
        this.onboardingModal = new OnboardingModal();

        this.appHeader = AppHeader({
            onCreateReport: () => this.reportFormModal.show('rep-title'),
            onAuthToggle: () => {
                appStore.get().user ?
                    showConfirmModal("Logout Confirmation", "Are you sure you want to log out? Your local private key (if used) will be cleared from memory.", () => idSvc.logout()) :
                    this.authModal.show('conn-nip07-btn');
            },
            onShowSettings: () => this.settingsModal.show()
        });
        this.filterControls = FilterControls();
        this.reportList = ReportList();
        this.globalLoadingSpinner = GlobalLoadingSpinner();

        this.root.append(
            this.appHeader,
            this.filterControls,
            this.reportList,
            this.globalLoadingSpinner
        );

        this.setupEventListeners();
        applyAllFilters();
        appStore.set(s => ({ ui: { ...s.ui, showReportList: true } }));

        if (!localStorage.getItem(C.ONBOARDING_KEY)) this.onboardingModal.show();
    }

    setupEventListeners() {
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
    }
}
