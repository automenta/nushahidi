import {appStore} from '../store.js';
import {idSvc, mapSvc} from '../services.js';
import {C, createEl} from '../utils.js';
import {showConfirmModal} from './modals.js';
import {applyAllFilters} from './components/FilterControls.js';
import {ReportList} from './components/ReportList.js';
import {GlobalLoadingSpinner} from './components/GlobalLoadingSpinner.js';
import {AppHeader} from './components/AppHeader.js';
import {ReportDetailsModal} from './components/ReportDetailsModal.js';
import {AuthModal} from './components/AuthModal.js';
import {ReportFormModal} from './components/ReportFormModal.js';
import {SettingsModal} from './components/SettingsModal.js';
import {OnboardingModal} from './components/OnboardingModal.js';
import {SidebarControls} from './components/SidebarControls.js';
import {FilterControls} from './components/FilterControls.js';

export class App {
    constructor(rootElement) {
        this.root = rootElement;
        this.root.innerHTML = '';

        this.headerEl = createEl('header', {class: 'app-header'});
        this.mainEl = createEl('main');
        this.sidebarEl = createEl('div', {class: 'app-sidebar'});
        this.mapContainerEl = createEl('div', {class: 'map-container', 'aria-label': 'Interactive Map'});
        this.footerEl = createEl('footer', {}, createEl('p', {textContent: '© NostrMapper Community'}));

        this.root.append(this.headerEl, this.mainEl, this.footerEl);
        this.mainEl.append(this.mapContainerEl, this.sidebarEl);

        // Modals that don't depend on mapSvc being initialized immediately
        this.authModal = new AuthModal();
        this.onboardingModal = new OnboardingModal();
        this.reportDetailsModal = null;

        // These will be initialized in the async init() method
        this.reportFormModal = null;
        this.settingsModal = null;
        this.appHeader = null;
        this.sidebarControls = null;
        this.filterControls = null;
        this.reportList = null;
        this.globalLoadingSpinner = null;

        this.setupEventListeners();
    }

    async init() {
        await mapSvc.init(this.mapContainerEl)
            .then(success => {
                if (!success) this.mapContainerEl.innerHTML = '<p style="color:red">Map init failed.</p>';
            })
            .catch(e => {
                console.error("Map initialization failed:", e);
                this.mapContainerEl.innerHTML = `<p style="color:red">Map init failed: ${e.message}</p>`;
            });

        // Now that mapSvc is initialized, instantiate components that depend on it
        this.reportFormModal = new ReportFormModal();
        this.settingsModal = new SettingsModal();

        this.appHeader = new AppHeader({
            onCreateReport: () => this.reportFormModal.show('.nstr-rep-form #field-title'),
            onAuthToggle: () => {
                appStore.get().user ?
                    showConfirmModal("Logout Confirmation", "Are you sure you want to log out? Your local private key (if used) will be cleared from memory.", () => idSvc.logout()) :
                    this.authModal.show('.auth-form #connectNip07Btn');
            },
            onShowSettings: () => this.settingsModal.show('.settings-sections h3')
        });
        this.headerEl.appendChild(this.appHeader.element);

        this.sidebarControls = new SidebarControls({
            onCreateReport: () => this.reportFormModal.show('.nstr-rep-form #field-title'),
            onShowSettings: () => this.settingsModal.show('.settings-sections h3')
        });
        this.sidebarEl.appendChild(this.sidebarControls.element);

        this.filterControls = new FilterControls();
        this.sidebarEl.appendChild(this.filterControls.element);

        this.reportList = new ReportList();
        this.sidebarEl.appendChild(this.reportList.element);

        this.globalLoadingSpinner = new GlobalLoadingSpinner();
        this.root.appendChild(this.globalLoadingSpinner.element);

        applyAllFilters();
        appStore.set(s => ({ui: {...s.ui, showReportList: true}}));

        if (!localStorage.getItem(C.ONBOARDING_KEY)) this.onboardingModal.show('.onboarding-modal h2');
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
                this.reportDetailsModal?.hide();
                this.reportDetailsModal = null;
                if (newState.ui.reportIdToView) {
                    const report = newState.reports.find(r => r.id === newState.ui.reportIdToView);
                    if (report) {
                        this.reportDetailsModal = new ReportDetailsModal(report, this.reportFormModal);
                        this.reportDetailsModal.show('.report-detail-modal .detail-title');
                    }
                }
            }
        });
    }
}
