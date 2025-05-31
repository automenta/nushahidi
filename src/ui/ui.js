import { appStore } from '../store.js';
import { idSvc } from '../services.js';
import { C, createEl, formatNpubShort, sanitizeHTML, showToast } from '../utils.js';
import { hideModal, showConfirmModal, showModal, Modal } from './modals.js';
import { AuthModal } from './components/AuthModal.js';
import { ReportFormModal } from './components/ReportFormModal.js';
import { SettingsModal } from './components/SettingsModal.js';
import { FilterControls, applyAllFilters } from './components/FilterControls.js';
import { handleReportAndFilterUpdates, handleReportViewing } from './statusDisplays.js';
import { ReportList } from './components/ReportList.js';

// Component: AppHeader
const AppHeader = (reportFormModal, authModal, settingsModal) => {
    const headerEl = createEl('header', { class: 'app-header' });
    const createReportBtn = createEl('button', { id: 'create-report-btn', textContent: 'Create Report' });
    const authButton = createEl('button', { id: 'auth-button', textContent: 'Connect Identity' });
    const settingsButton = createEl('button', { id: 'settings-btn', textContent: 'Settings' });
    const userDisplay = createEl('span', { id: 'user-display', class: 'user-display' });

    createReportBtn.onclick = () => showModal(reportFormModal, 'rep-title');
    settingsButton.onclick = () => showModal(settingsModal);

    authButton.onclick = () => {
        appStore.get().user ?
            showConfirmModal("Logout Confirmation", "Are you sure you want to log out? Your local private key (if used) will be cleared from memory.", () => idSvc.logout()) :
            showModal(authModal, 'conn-nip07-btn');
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
const ConnectionStatus = (settingsModal) => {
    const statusEl = createEl('div', { id: 'connection-status', class: 'connection-status' });
    const onlineStatusSpan = createEl('span', { id: 'online-status', textContent: 'Offline' });
    const syncStatusSpan = createEl('span', { id: 'sync-status', textContent: 'Sync Status: Unknown' });
    const offlineQueueCountSpan = createEl('span', { id: 'offline-queue-count', textContent: '' });

    const updateConnectionDisplay = (online) => {
        onlineStatusSpan.textContent = online ? 'Online' : 'Offline';
        onlineStatusSpan.className = online ? 'status-online' : 'status-offline';
    };

    const updateSyncDisplay = async () => {
        const { online, reports } = appStore.get();
        const offlineQueue = await dbSvc.getOfflineQ(); // Assuming dbSvc is available globally or passed as prop
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
        // Also update sync display if reports or offline queue change (though offline queue changes are not directly in appStore)
        // For offline queue, we'll rely on explicit calls or a more granular store update if it were part of appStore.
        // For now, it's called on online status change.
    });

    // Initial render
    updateConnectionDisplay(appStore.get().online);
    updateSyncDisplay();

    statusEl.append(onlineStatusSpan, syncStatusSpan, offlineQueueCountSpan);
    return statusEl;
};

// Component: GlobalLoadingSpinner
const GlobalLoadingSpinner = () => {
    const spinnerEl = createEl('div', { id: 'global-loading-spinner', class: 'spinner-overlay', style: 'display: none;' });
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
    const onboardingModalElement = Modal('onboarding-info', 'Welcome to NostrMapper!', contentRoot => {
        const gotItBtn = createEl('button', { textContent: 'Got It!' });
        const closeBtn = contentRoot.querySelector('.close-btn'); // Modal utility adds this

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
