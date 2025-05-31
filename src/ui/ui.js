import { appStore } from '../store.js';
import { idSvc, dbSvc } from '../services.js'; // dbSvc needed for ConnectionStatus
import { C, createEl, formatNpubShort, showToast } from '../utils.js';
import { hideModal, showConfirmModal, showModal, Modal } from './modals.js';
import { AuthModal } from './components/AuthModal.js';
import { ReportFormModal } from './components/ReportFormModal.js';
import { SettingsModal } from './components/SettingsModal.js';
import { FilterControls, applyAllFilters } from './components/FilterControls.js';
import { handleReportAndFilterUpdates, handleReportViewing } from './statusDisplays.js';
import { ReportList } from './components/ReportList.js';

// Component: AppHeader
const AppHeader = ({ reportFormModal, authModal, settingsModal }) => {
    const headerEl = createEl('header', { class: 'app-header' });
    const createReportBtn = createEl('button', { textContent: 'Create Report' });
    const authButton = createEl('button', { textContent: 'Connect Identity' });
    const settingsButton = createEl('button', { textContent: 'Settings' });
    const userDisplay = createEl('span', { class: 'user-display' });

    createReportBtn.onclick = () => showModal(reportFormModal, 'rep-title');
    settingsButton.onclick = () => showModal(settingsModal);

    authButton.onclick = () => {
        appStore.get().user ?
            showConfirmModal("Logout Confirmation", "Are you sure you want to log out? Your local private key (if used) will be cleared from memory.", () => idSvc.logout()) :
            showModal(authModal, authModal.querySelector('#conn-nip07-btn'));
    };

    const updateAuthDisplay = (pubkey) => {
        if (pubkey) {
            userDisplay.textContent = `Connected: ${formatNpubShort(pubkey)}`;
            authButton.textContent = 'Logout';
        } else {
            userDisplay.textContent = 'Not Connected';
            authButton.textContent = 'Connect Identity';
        }
    };

    appStore.on((newState, oldState) => {
        if (newState.user?.pk !== oldState?.user?.pk) {
            updateAuthDisplay(newState.user?.pk);
        }
    });

    updateAuthDisplay(appStore.get().user?.pk); // Initial render

    headerEl.append(
        createEl('h1', { textContent: 'NostrMapper' }),
        createReportBtn,
        authButton,
        settingsButton,
        userDisplay
    );
    return headerEl;
};

// Component: ConnectionStatus
const ConnectionStatus = ({ settingsModal }) => {
    const statusEl = createEl('div', { class: 'connection-status' });
    const onlineStatusSpan = createEl('span', { textContent: 'Offline' });
    const syncStatusSpan = createEl('span', { textContent: 'Sync Status: Unknown' });
    const offlineQueueCountSpan = createEl('span', { textContent: '' });

    const updateConnectionDisplay = (online) => {
        onlineStatusSpan.textContent = online ? 'Online' : 'Offline';
        onlineStatusSpan.className = online ? 'status-online' : 'status-offline';
    };

    const updateSyncDisplay = async () => {
        const { online, reports } = appStore.get();
        const offlineQueue = await dbSvc.getOfflineQ();
        const pendingEvents = offlineQueue.length;

        if (!online) {
            syncStatusSpan.textContent = `Sync Status: Offline (${pendingEvents} pending)`;
            offlineQueueCountSpan.textContent = pendingEvents > 0 ? ` (${pendingEvents})` : '';
            offlineQueueCountSpan.onclick = () => showModal(settingsModal);
            offlineQueueCountSpan.style.cursor = pendingEvents > 0 ? 'pointer' : 'default';
        } else {
            syncStatusSpan.textContent = `Sync Status: Online (${reports.length} reports)`;
            offlineQueueCountSpan.textContent = '';
            offlineQueueCountSpan.onclick = null;
            offlineQueueCountSpan.style.cursor = 'default';
        }
    };

    appStore.on((newState, oldState) => {
        if (newState.online !== oldState?.online) {
            updateConnectionDisplay(newState.online);
            updateSyncDisplay();
        }
        // Also update sync display if reports change (offline queue changes are not directly in appStore)
        if (newState.reports !== oldState?.reports) {
            updateSyncDisplay();
        }
    });

    // Initial render
    updateConnectionDisplay(appStore.get().online);
    updateSyncDisplay();

    statusEl.append(onlineStatusSpan, syncStatusSpan, offlineQueueCountSpan);
    return statusEl;
};

// Component: GlobalLoadingSpinner
const GlobalLoadingSpinner = () => {
    const spinnerEl = createEl('div', { class: 'spinner-overlay', style: 'display: none;' });
    spinnerEl.appendChild(createEl('div', { class: 'spinner' }));

    appStore.on((newState, oldState) => {
        if (newState.ui.loading !== oldState?.ui?.loading) {
            spinnerEl.style.display = newState.ui.loading ? 'flex' : 'none';
        }
    });

    return spinnerEl;
};

// Component: OnboardingModal
const OnboardingModalComponent = () => {
    let onboardingModalElement; // Declare here so it's accessible in hideOnboarding

    onboardingModalElement = Modal('onboarding-info', 'Welcome to NostrMapper!', (contentRoot, modalEl) => {
        const gotItBtn = createEl('button', { textContent: 'Got It!' });
        const closeBtn = modalEl.querySelector('.close-btn'); // Modal utility adds this

        const hideOnboarding = () => {
            localStorage.setItem(C.ONBOARDING_KEY, 'true');
            hideModal(onboardingModalElement);
        };

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
    if (!root) {
        console.error('Root element #app not found!');
        return;
    }
    root.innerHTML = ''; // Clear existing content

    // Initialize modals (they append themselves to body)
    const authModalElement = AuthModal();
    const reportFormModalElement = ReportFormModal();
    const settingsModalElement = SettingsModal();
    const onboardingModalElement = OnboardingModalComponent();

    // Render main UI components into the root
    const header = AppHeader({ reportFormModal: reportFormModalElement, authModal: authModalElement, settingsModal: settingsModalElement });
    const filterControls = FilterControls(); // FilterControls now returns its root element
    const reportList = ReportList(); // ReportList now returns its root element
    const connectionStatus = ConnectionStatus({ settingsModal: settingsModalElement });
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
    appStore.set(s => ({ ui: { ...s.ui, showReportList: true } }));

    // Global state listeners
    appStore.on((newState, oldState) => {
        handleReportAndFilterUpdates(newState, oldState);
        if (newState.ui.reportIdToView !== oldState?.ui?.reportIdToView) handleReportViewing(newState.ui.reportIdToView, newState.reports);
    });

    // Show onboarding modal if not seen before
    if (!localStorage.getItem(C.ONBOARDING_KEY)) {
        showModal(onboardingModalElement);
    }
}
