import {appStore} from '../store.js';
import {showToast} from '../utils.js';
import {dbSvc} from './db.js';

export const offSvc = {
    async procQ() {
        // This function is now primarily triggered by the service worker's sync event.
        // The actual fetching and re-queuing logic is handled by Workbox's BackgroundSyncPlugin.
        // This function can be used for any additional client-side processing needed after a sync.
        const offlineQueueCount = (await dbSvc.getOfflineQ()).length;
        appStore.set(s => ({offlineQueueCount}));
        if (offlineQueueCount > 0) {
            showToast("Offline queue processing initiated by service worker.", 'info');
        }
    },

    setupSyncLs() {
        // The 'online' event listener is still useful for immediate UI feedback,
        // but the core queue processing is now handled by the SW.
        window.addEventListener('online', () => this.procQ());

        if ('serviceWorker' in navigator && navigator.serviceWorker.ready) {
            navigator.serviceWorker.ready.then(registration => {
                if ('sync' in registration) {
                    // This listener ensures that the client-side procQ is called when the SW syncs.
                    // The SW itself handles the actual network requests and re-queuing.
                    registration.addEventListener('sync', event => {
                        if (event.tag === 'nostrPublishQueue') event.waitUntil(this.procQ());
                    });
                }
            });
        }
        // Initial check for queue status
        this.procQ();
    },
};
