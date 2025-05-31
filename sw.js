import {cleanupOutdatedCaches, precacheAndRoute} from 'workbox-precaching';
import {NavigationRoute, registerRoute} from 'workbox-routing';
import {NetworkFirst, StaleWhileRevalidate} from 'workbox-strategies';
import {ExpirationPlugin} from 'workbox-expiration';
import {BackgroundSyncPlugin} from 'workbox-background-sync';

cleanupOutdatedCaches();

precacheAndRoute(self.__WB_MANIFEST || []); // Added defensive check for __WB_MANIFEST

const navigationRoute = new NavigationRoute(new StaleWhileRevalidate({
  cacheName: 'app-shell-navigations',
}));
registerRoute(navigationRoute);

const nostrPublishQueue = new BackgroundSyncPlugin('nostrPublishQueue', {
  maxRetentionTime: 48 * 60 * 60 * 1000,
  async onSync({ queue }) {
    let entry;
    while (entry = await queue.shiftRequest()) {
      try {
        const response = await fetch(entry.request.clone());
        if (!response.ok) {
          console.error('SW: Server error during sync, not re-queueing:', entry.request.url, response.status);
        } else {
          console.log('SW: Queued Nostr event published successfully via sync.');
        }
      } catch (error) {
        console.error('SW: Network error during sync, re-queueing for next sync:', entry.request.url, error);
        await queue.unshiftRequest(entry);
        throw new Error('SW: Sync failed, will retry.');
      }
    }
  }
});

registerRoute(
  ({ url, request }) => url.pathname === '/api/publishNostrEvent' && request.method === 'POST',
  new NetworkFirst({
    cacheName: 'nostr-publish-api-runtime',
    plugins: [nostrPublishQueue]
  })
);

registerRoute(
  ({url}) => url.href.includes('tile.openstreetmap.org') || url.href.includes('tile.thunderforest.com'),
  new StaleWhileRevalidate({
    cacheName: 'map-tiles',
    plugins: [
      new ExpirationPlugin({ maxEntries: 500, maxAgeSeconds: 30 * 24 * 60 * 60 }),
      { cacheableResponse: { statuses: [0, 200] } }
    ],
  })
);


self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

self.addEventListener('activate', (event) => {
  event.waitUntil(clients.claim());
});
