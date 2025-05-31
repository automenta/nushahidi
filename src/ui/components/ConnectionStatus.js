import {appStore} from '../../store.js';
import {createEl} from '../../utils.js';

export class ConnectionStatus {
    constructor(onShowSettings) {
        this.onShowSettings = onShowSettings;
        this.connectionStatusEl = createEl('span');
        this.syncStatusEl = createEl('span');
        this.offlineQueueCountEl = createEl('span');
        this.container = createEl('div', {class: 'connection-status'}, [
            this.connectionStatusEl,
            this.syncStatusEl,
            this.offlineQueueCountEl
        ]);

        this.render(appStore.get());

        this.unsubscribe = appStore.on((newState, oldState) => {
            if (newState.online !== oldState?.online || newState.offlineQueueCount !== oldState?.offlineQueueCount) {
                this.render(newState);
            }
        });
    }

    render(state) {
        this.connectionStatusEl.textContent = state.online ? 'Online' : 'Offline';
        this.connectionStatusEl.className = state.online ? 'status-online' : 'status-offline';

        if (!state.online) {
            this.syncStatusEl.textContent = `Sync Status: Offline`;
            this.offlineQueueCountEl.textContent = state.offlineQueueCount > 0 ? ` (${state.offlineQueueCount} pending)` : '';
            this.offlineQueueCountEl.onclick = () => state.offlineQueueCount > 0 && this.onShowSettings?.();
            this.offlineQueueCountEl.style.cursor = state.offlineQueueCount > 0 ? 'pointer' : 'default';
        } else {
            this.syncStatusEl.textContent = `Sync Status: Online`;
            this.offlineQueueCountEl.textContent = '';
            this.offlineQueueCountEl.onclick = null;
            this.offlineQueueCountEl.style.cursor = 'default';
        }
        return this.container;
    }

    get element() {
        return this.container;
    }
}
