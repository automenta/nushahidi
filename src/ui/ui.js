import {appStore} from '../store.js';
import {C, createEl} from '../utils.js';
import {hideModal, showModal, Modal} from './modals.js';
import {FilterControls, applyAllFilters} from './components/FilterControls.js';
import {ReportList} from './components/ReportList.js';
import {ConnectionStatus} from './components/ConnectionStatus.js';
import {GlobalLoadingSpinner} from './components/GlobalLoadingSpinner.js';
import {AppHeader} from './components/AppHeader.js';
import {ReportDetailsModal} from './components/ReportDetailsModal.js';

const ensureContainerExists = (id, parent = document.body) => {
    let container = document.getElementById(id);
    if (!container) {
        container = createEl('div', { id: id });
        parent.appendChild(container);
    }
    return container;
};

const OnboardingModalComponent = () => {
    let onboardingModalElement;

    const hideOnboarding = () => {
        localStorage.setItem(C.ONBOARDING_KEY, 'true');
        hideModal(onboardingModalElement);
    };

    onboardingModalElement = Modal('onboarding-info', 'Welcome to NostrMapper!', (contentRoot, modalEl) => {
        const gotItBtn = createEl('button', { textContent: 'Got It!' });
        const closeBtn = modalEl.querySelector('.close-btn');

        closeBtn?.addEventListener('click', hideOnboarding);
        gotItBtn.addEventListener('click', hideOnboarding);

        return [
            createEl('p', { textContent: 'NostrMapper is a decentralized mapping application built on Nostr. Report incidents, observations, and aid requests directly to the Nostr network.' }),
            createEl('p', { textContent: 'Your reports are public and uncensorable. Connect your Nostr identity to start contributing!' }),
            gotItBtn
        ];
    });
    return onboardingModalElement;
};

export function initUI() {
    const root = document.getElementById('app');
    if (!root) return;
    root.innerHTML = '';

    ensureContainerExists('filter-controls');
    ensureContainerExists('report-list-container');
    ensureContainerExists('report-list', document.getElementById('report-list-container'));

    const appHeader = AppHeader();
    const filterControls = FilterControls();
    const reportList = ReportList();
    const connectionStatus = ConnectionStatus();
    const globalLoadingSpinner = GlobalLoadingSpinner();
    const onboardingModalElement = OnboardingModalComponent();

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
                    const reportDetailsModalElement = ReportDetailsModal(report);
                    showModal(reportDetailsModalElement, 'detail-title');
                }
            }
        }
    });

    applyAllFilters();
    appStore.set(s => ({ ui: { ...s.ui, showReportList: true } }));

    if (!localStorage.getItem(C.ONBOARDING_KEY)) showModal(onboardingModalElement);
}
