import {appStore} from '../../store.js';
import {createEl, formatNpubShort} from '../../utils.js';

export function AppHeader(props) {
    const { onCreateReport, onAuthToggle, onShowSettings } = props;
    let headerEl;
    let createReportBtn;
    let authButton;
    let settingsButton;
    let userDisplay;
    let connectionStatusEl;
    let syncStatusEl;
    let offlineQueueCountEl;

    const updateAuthDisplay = (pubkey) => {
        if (pubkey) {
            userDisplay.textContent = `Connected: ${formatNpubShort(pubkey)}`;
            authButton.textContent = 'Logout';
        } else {
            userDisplay.textContent = 'Not Connected';
            authButton.textContent = 'Connect Identity';
        }
    };

    const updateConnectionDisplay = (online) => {
        connectionStatusEl.textContent = online ? 'Online' : 'Offline';
        connectionStatusEl.className = online ? 'status-online' : 'status-offline';
    };

    const updateSyncDisplay = async (online, pendingEvents, onShowSettingsCallback) => {
        if (!online) {
            syncStatusEl.textContent = `Sync Status: Offline (${pendingEvents} pending)`;
            offlineQueueCountEl.textContent = pendingEvents > 0 ? ` (${pendingEvents})` : '';
            offlineQueueCountEl.onclick = () => pendingEvents > 0 && onShowSettingsCallback?.();
            offlineQueueCountEl.style.cursor = pendingEvents > 0 ? 'pointer' : 'default';
        } else {
            syncStatusEl.textContent = `Sync Status: Online`;
            offlineQueueCountEl.textContent = '';
            offlineQueueCountEl.onclick = null;
            offlineQueueCountEl.style.cursor = 'default';
        }
    };

    const render = (state) => {
        if (!headerEl) {
            headerEl = createEl('header', { class: 'app-header' });
            createReportBtn = createEl('button', { textContent: 'Create Report' });
            authButton = createEl('button');
            settingsButton = createEl('button', { textContent: 'Settings' });
            userDisplay = createEl('span', { class: 'user-display' });
            connectionStatusEl = createEl('span');
            syncStatusEl = createEl('span');
            offlineQueueCountEl = createEl('span');

            createReportBtn.onclick = onCreateReport;
            settingsButton.onclick = onShowSettings;
            authButton.onclick = onAuthToggle;

            headerEl.append(
                createEl('h1', { textContent: 'NostrMapper' }),
                createReportBtn,
                authButton,
                settingsButton,
                userDisplay,
                createEl('div', { class: 'connection-status' }, [connectionStatusEl, syncStatusEl, offlineQueueCountEl])
            );
        }
        updateAuthDisplay(state.user?.pk);
        updateConnectionDisplay(state.online);
        updateSyncDisplay(state.online, state.offlineQueueCount, onShowSettings);
        return headerEl;
    };

    appStore.on(async (newState, oldState) => {
        if (newState.user?.pk !== oldState?.user?.pk) {
            updateAuthDisplay(newState.user?.pk);
        }
        if (newState.online !== oldState?.online) {
            updateConnectionDisplay(newState.online);
        }
        if (newState.online !== oldState?.online || newState.offlineQueueCount !== oldState?.offlineQueueCount) {
            updateSyncDisplay(newState.online, newState.offlineQueueCount, onShowSettings);
        }
    });

    return render(appStore.get());
}
