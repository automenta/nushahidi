import { BackgroundSyncPlugin } from 'workbox-background-sync';
import { registerRoute } from 'workbox-routing';
import { NetworkOnly } from 'workbox-strategies';

const nostrPublishQueue = new BackgroundSyncPlugin('nostrPublishQueue', {
  maxRetentionTime: 48 * 60 * 60 * 1000,
  async onSync({ queue }) {
    let entry;
    while (entry = await queue.shiftRequest()) {
      try {
        const response = await fetch(entry.request.clone());
        if (!response.ok) {
          console.error('SW: Server error during sync, not re-queueing:', entry.request.url, response.status, response.statusText);
          // Re-queue if it's a server error that might resolve later (e.g., 5xx)
          if (response.status >= 500 && response.status < 600) {
            await queue.unshiftRequest(entry);
            self.clients.matchAll().then(clients => {
              clients.forEach(client => client.postMessage({ type: 'OFFLINE_QUEUE_UPDATE', count: queue.size }));
            });
            throw new Error(`Server error: ${response.statusText}`);
          } else {
            // For client errors (4xx) or other non-retryable errors, don't re-queue
            console.warn('SW: Non-retryable server error during sync, not re-queueing:', entry.request.url, response.status, response.statusText);
          }
        } else {
          console.log('SW: Queued Nostr event published successfully via sync.');
        }
      } catch (error) {
        console.error('SW: Failed to replay queued Nostr event:', error);
        await queue.unshiftRequest(entry); // Re-queue on network errors
        self.clients.matchAll().then(clients => {
          clients.forEach(client => client.postMessage({ type: 'OFFLINE_QUEUE_UPDATE', count: queue.size }));
        });
        throw error;
      }
    }
    // After processing all items, update the client with the final queue size (likely 0)
    self.clients.matchAll().then(clients => {
      clients.forEach(client => client.postMessage({ type: 'OFFLINE_QUEUE_UPDATE', count: queue.size }));
    });
  },
});

registerRoute(
  ({ url }) => url.pathname === '/api/publishNostrEvent',
  new NetworkOnly({
    plugins: [nostrPublishQueue],
  }),
  'POST'
);

self.addEventListener('install', event => {
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(clients.claim());
});
