import {appStore} from '../store.js';
import {showToast} from '../utils.js';
import {dbSvc} from './db.js';
import {nostrSvc} from './nostr.js';

export const offSvc = {
    async procQ() {
        const queueItems = await dbSvc.getOfflineQ();
        appStore.set(s => ({offlineQueueCount: queueItems.length}));

        if (queueItems.length > 0) {
            showToast("Attempting to publish queued events...", 'info');
            for (const item of queueItems) {
                try {
                    // Pass fromOfflineQueue=true to prevent re-adding to queue if direct publish fails
                    await nostrSvc.pubEv(item.event, true);
                    await dbSvc.rmOfflineQ(item.qid);
                    showToast(`Queued event ${item.qid.substring(0, 8)}... published.`, 'success', 2000);
                } catch (e) {
                    console.error(`Failed to publish queued event ${item.qid.substring(0, 8)}...:`, e);
                    showToast(`Failed to publish queued event ${item.qid.substring(0, 8)}...: ${e.message}`, 'error', 3000);
                    // Keep in queue for next retry
                }
            }
            // Re-evaluate queue count after processing
            const updatedQueueCount = (await dbSvc.getOfflineQ()).length;
            appStore.set(s => ({offlineQueueCount: updatedQueueCount}));
            if (updatedQueueCount === 0) {
                showToast("All offline events published!", 'success');
            } else {
                showToast(`${updatedQueueCount} events remaining in offline queue.`, 'info');
            }
        } else {
            showToast("Offline queue is empty.", 'info');
        }
    },

    setupSyncLs() {
        // The 'online' event listener is still useful for immediate UI feedback.
        window.addEventListener('online', () => this.procQ());

        // Remove the service worker sync listener as the client will now handle publishing directly.
        // The service worker's BackgroundSyncPlugin for /api/publishNostrEvent is also removed.
        // The client-side procQ will be triggered by 'online' event or manually.

        // Initial check for queue status
        this.procQ();
    },
};
