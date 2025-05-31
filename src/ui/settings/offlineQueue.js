import {C, createEl, sanitizeHTML} from '../../utils.js';
import {dbSvc, nostrSvc} from '../../services.js';
import {withLoading, withToast} from '../../decorators.js';
import {renderList} from '../forms.js';
import {appStore} from '../../store.js';

const getOfflineQueueEventType = kind => {
    switch (kind) {
        case C.NOSTR_KIND_REPORT: return 'Report';
        case C.NOSTR_KIND_REACTION: return 'Reaction';
        case C.NOSTR_KIND_NOTE: return 'Comment';
        case 5: return 'Deletion';
        case C.NOSTR_KIND_PROFILE: return 'Profile';
        case C.NOSTR_KIND_CONTACTS: return 'Contacts';
        default: return `Kind ${kind}`;
    }
};

class OfflineQueueItem {
    constructor(item) {
        this.item = item;
        this.element = this.render();
    }

    render() {
        const eventType = getOfflineQueueEventType(this.item.event.kind);
        const timestamp = new Date(this.item.ts).toLocaleString();
        const contentSnippet = this.item.event.content.substring(0, 50) + (this.item.event.content.length > 50 ? '...' : '');
        const eventIdSnippet = this.item.event.id.substring(0, 8);
        return createEl('span', {innerHTML: `<strong>${sanitizeHTML(eventType)}</strong> (${timestamp}) - ID: ${sanitizeHTML(eventIdSnippet)}... <br>Content: <em>${sanitizeHTML(contentSnippet || 'N/A')}</em>`});
    }
}

export class OfflineQueueSection {
    constructor() {
        this.sectionEl = createEl('section');
        this.sectionEl.appendChild(createEl('h3', {textContent: 'Offline Queue'}));
        this.listContainer = createEl('div');
        this.sectionEl.appendChild(createEl('p', {textContent: 'Events waiting to be published when online.'}));
        this.sectionEl.appendChild(this.listContainer);

        this.renderQueue();

        this.unsubscribe = appStore.on((newState, oldState) => {
            if (newState.online !== oldState?.online || newState.offlineQueueCount !== oldState?.offlineQueueCount) {
                this.renderQueue();
            }
        });
    }

    async renderQueue() {
        const queueItems = await dbSvc.getOfflineQ();
        appStore.set(s => ({offlineQueueCount: queueItems.length}));
        const actionsConfig = [
            {
                label: 'Retry',
                className: 'retry-offline-q-btn',
                onClick: withLoading(withToast(async item => {
                    await nostrSvc.pubEv(item.event);
                    await dbSvc.rmOfflineQ(item.qid);
                    await this.renderQueue();
                }, null, "Error retrying event")),
            },
            {
                label: 'Delete',
                className: 'remove-offline-q-btn',
                onClick: withLoading(withToast(async item => {
                    await dbSvc.rmOfflineQ(item.qid);
                    await this.renderQueue();
                }, null, "Error deleting event")),
            }
        ];
        renderList(this.listContainer, queueItems, OfflineQueueItem, actionsConfig, 'offline-q-entry');
    }

    get element() {
        return this.sectionEl;
    }
}
