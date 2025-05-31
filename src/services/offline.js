import { appStore } from '../store.js';
import { showToast } from '../utils.js';
import { dbSvc } from './db.js';

export const offSvc = {
    async procQ() {
        if (!appStore.get().online) {
            return;
        }
        const items = await dbSvc.getOfflineQ();
        if (items.length === 0) {
            return;
        }
        for (const item of items) {
            try {
                const response = await fetch('/api/publishNostrEvent', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(item.event)
                });
                if (response.ok || response.status === 503) {
                    await dbSvc.rmOfflineQ(item.qid);
                }
            } catch (e) {
                console.error("Error processing offline queue item:", e);
                showToast(`Failed to sync offline event: ${e.message}`, 'error');
            }
        }
    },

    setupSyncLs() {
        window.addEventListener('online', () => { this.procQ() });
        window.addEventListener('offline', () => {});

        if ('serviceWorker' in navigator && navigator.serviceWorker.ready) {
            navigator.serviceWorker.ready.then(registration => {
                if ('sync' in registration) {
                    registration.addEventListener('sync', event => {
                        if (event.tag === 'nostrPublishQueue') {
                            event.waitUntil(this.procQ());
                        }
                    });
                }
            });
        }
        this.procQ();
    },
};
