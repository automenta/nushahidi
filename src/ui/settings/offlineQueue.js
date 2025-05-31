import { C, createEl, sanitizeHTML, showToast } from '../../utils.js';
import { appStore } from '../../store.js';
import { dbSvc, nostrSvc } from '../../services.js';
import { withLoading, withToast } from '../../decorators.js';
import { renderList } from '../forms.js';

export const getOfflineQueueEventType = (kind) => {
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

export const offlineQueueItemRenderer = item => {
    const eventType = getOfflineQueueEventType(item.event.kind);
    const timestamp = new Date(item.ts).toLocaleString();
    const contentSnippet = item.event.content.substring(0, 50) + (item.event.content.length > 50 ? '...' : '');
    const eventIdSnippet = item.event.id.substring(0, 8);
    return createEl('span', { innerHTML: `<strong>${sanitizeHTML(eventType)}</strong> (${timestamp}) - ID: ${sanitizeHTML(eventIdSnippet)}... <br>Content: <em>${sanitizeHTML(contentSnippet || 'N/A')}</em>` });
};

export const offlineQueueActionsConfig = (modalContent) => [
    {
        label: 'Retry',
        className: 'retry-offline-q-btn',
        onClick: withLoading(withToast(async (item) => {
            await nostrSvc.pubEv(item.event);
            await dbSvc.rmOfflineQ(item.qid);
            renderOfflineQueue(modalContent);
        }, null, "Error retrying event")),
    },
    {
        label: 'Delete',
        className: 'remove-offline-q-btn',
        onClick: withLoading(withToast(async (item) => {
            await dbSvc.rmOfflineQ(item.qid);
            renderOfflineQueue(modalContent);
        }, null, "Error deleting event")),
    }
];

export const renderOfflineQueue = async (modalContent) => {
    const queueItems = await dbSvc.getOfflineQ();
    renderList('offline-queue-list', queueItems, offlineQueueItemRenderer, offlineQueueActionsConfig(modalContent), 'offline-q-entry', modalContent);
};
