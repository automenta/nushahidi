import {appStore} from '../../store.js';
import {createEl} from '../../utils.js';
import {dbSvc} from '../../services.js';
import {showModal} from '../modals.js';

export function ConnectionStatus(props) {
    const { onShowSettings } = props;
    let statusEl;
    let onlineStatusSpan;
    let syncStatusSpan;
    let offlineQueueCountSpan;

    const updateDisplay = async (online, reports) => {
        onlineStatusSpan.textContent = online ? 'Online' : 'Offline';
        onlineStatusSpan.className = online ? 'status-online' : 'status-offline';

        const offlineQueue = await dbSvc.getOfflineQ();
        const pendingEvents = offlineQueue.length;

        if (!online) {
            syncStatusSpan.textContent = `Sync Status: Offline (${pendingEvents} pending)`;
            offlineQueueCountSpan.textContent = pendingEvents > 0 ? ` (${pendingEvents})` : '';
            offlineQueueCountSpan.onclick = () => pendingEvents > 0 && onShowSettings?.();
            offlineQueueCountSpan.style.cursor = pendingEvents > 0 ? 'pointer' : 'default';
        } else {
            syncStatusSpan.textContent = `Sync Status: Online (${reports.length} reports)`;
            offlineQueueCountSpan.textContent = '';
            offlineQueueCountSpan.onclick = null;
            offlineQueueCountSpan.style.cursor = 'default';
        }
    };

    const render = (state) => {
        if (!statusEl) {
            statusEl = createEl('div', { class: 'connection-status' });
            onlineStatusSpan = createEl('span');
            syncStatusSpan = createEl('span');
            offlineQueueCountSpan = createEl('span');
            statusEl.append(onlineStatusSpan, syncStatusSpan, offlineQueueCountSpan);
        }
        updateDisplay(state.online, state.reports);
        return statusEl;
    };

    appStore.on((newState, oldState) => {
        if (newState.online !== oldState?.online || newState.reports !== oldState?.reports) {
            updateDisplay(newState.online, newState.reports);
        }
    });

    return render(appStore.get());
}
