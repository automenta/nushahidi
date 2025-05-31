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
          throw new Error(`Server error: ${response.statusText}`);
        } else {
          console.log('SW: Queued Nostr event published successfully via sync.');
        }
      } catch (error) {
        console.error('SW: Failed to replay queued Nostr event:', error);
        await queue.unshiftRequest(entry);
        throw error;
      }
    }
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
