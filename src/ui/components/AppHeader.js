import {appStore} from '../../store.js';
import {createEl, formatNpubShort} from '../../utils.js';

export class AppHeader {
    constructor(props) {
        this.onCreateReport = props.onCreateReport;
        this.onAuthToggle = props.onAuthToggle;
        this.onShowSettings = props.onShowSettings;

        this.headerEl = createEl('header', { class: 'app-header' });
        this.createReportBtn = createEl('button', { textContent: 'Create Report' });
        this.authButton = createEl('button');
        this.settingsButton = createEl('button', { textContent: 'Settings' });
        this.userDisplay = createEl('span', { class: 'user-display' });
        this.connectionStatusEl = createEl('span');
        this.syncStatusEl = createEl('span');
        this.offlineQueueCountEl = createEl('span');

        this.createReportBtn.onclick = this.onCreateReport;
        this.settingsButton.onclick = this.onShowSettings;
        this.authButton.onclick = this.onAuthToggle;

        this.headerEl.append(
            createEl('h1', { textContent: 'NostrMapper' }),
            this.createReportBtn,
            this.authButton,
            this.settingsButton,
            this.userDisplay,
            createEl('div', { class: 'connection-status' }, [this.connectionStatusEl, this.syncStatusEl, this.offlineQueueCountEl])
        );

        this.render(appStore.get());

        appStore.on(async (newState, oldState) => {
            if (newState.user?.pk !== oldState?.user?.pk) {
                this.updateAuthDisplay(newState.user?.pk);
            }
            if (newState.online !== oldState?.online) {
                this.updateConnectionDisplay(newState.online);
            }
            if (newState.online !== oldState?.online || newState.offlineQueueCount !== oldState?.offlineQueueCount) {
                this.updateSyncDisplay(newState.online, newState.offlineQueueCount);
            }
        });
    }

    updateAuthDisplay(pubkey) {
        if (pubkey) {
            this.userDisplay.textContent = `Connected: ${formatNpubShort(pubkey)}`;
            this.authButton.textContent = 'Logout';
        } else {
            this.userDisplay.textContent = 'Not Connected';
            this.authButton.textContent = 'Connect Identity';
        }
    }

    updateConnectionDisplay(online) {
        this.connectionStatusEl.textContent = online ? 'Online' : 'Offline';
        this.connectionStatusEl.className = online ? 'status-online' : 'status-offline';
    }

    updateSyncDisplay(online, pendingEvents) {
        if (!online) {
            this.syncStatusEl.textContent = `Sync Status: Offline (${pendingEvents} pending)`;
            this.offlineQueueCountEl.textContent = pendingEvents > 0 ? ` (${pendingEvents})` : '';
            this.offlineQueueCountEl.onclick = () => pendingEvents > 0 && this.onShowSettings?.();
            this.offlineQueueCountEl.style.cursor = pendingEvents > 0 ? 'pointer' : 'default';
        } else {
            this.syncStatusEl.textContent = `Sync Status: Online`;
            this.offlineQueueCountEl.textContent = '';
            this.offlineQueueCountEl.onclick = null;
            this.offlineQueueCountEl.style.cursor = 'default';
        }
    }

    render(state) {
        this.updateAuthDisplay(state.user?.pk);
        this.updateConnectionDisplay(state.online);
        this.updateSyncDisplay(state.online, state.offlineQueueCount);
        return this.headerEl;
    }

    get element() {
        return this.headerEl;
    }
}
