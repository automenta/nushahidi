// This file would be used if using workbox's injectManifest strategy.
// For generateSW, workbox-cli builds this file based on workbox-config.cjs.
// The following is a conceptual structure for injectManifest.

import { precacheAndRoute, cleanupOutdatedCaches } from 'workbox-precaching';
import { registerRoute, NavigationRoute } from 'workbox-routing';
import { StaleWhileRevalidate, CacheFirst, NetworkFirst } from 'workbox-strategies';
import { ExpirationPlugin } from 'workbox-expiration';
import { BackgroundSyncPlugin } from 'workbox-background-sync';

cleanupOutdatedCaches();

// Precache assets injected by Workbox build process
precacheAndRoute(self.__WB_MANIFEST);

// Cache the PWA app shell (index.html) for navigation requests
const navigationRoute = new NavigationRoute(new StaleWhileRevalidate({
  cacheName: 'app-shell-navigations',
}));
registerRoute(navigationRoute);

// Runtime caching for other assets (JS, CSS, fonts, images)
// These are often handled by precaching if they are part of the build.
// If loaded dynamically or from CDNs, add rules here.

// Background Sync for Nostr event publishing
const nostrPublishQueue = new BackgroundSyncPlugin('nostrPublishQueue', {
  maxRetentionTime: 48 * 60 * 60 * 1000, // Retry for up to 48 hours
  async onSync({ queue }) {
    let entry;
    while (entry = await queue.shiftRequest()) {
      try {
        const response = await fetch(entry.request.clone());
        if (!response.ok) {
          // If server error, re-queue if appropriate, or log and discard
          console.error('SW: Server error during sync, not re-queueing:', entry.request.url, response.status);
          // For this app, we assume if the server responds with non-ok, it's a final state for that attempt.
        } else {
          console.log('SW: Queued Nostr event published successfully via sync.');
        }
      } catch (error) { // Network error
        console.error('SW: Network error during sync, re-queueing for next sync:', entry.request.url, error);
        await queue.unshiftRequest(entry); // Re-add to front for retry
        throw new Error('SW: Sync failed, will retry.'); // Signal BG Sync to retry
      }
    }
  }
});

registerRoute(
  ({ url, request }) => url.pathname === '/api/publishNostrEvent' && request.method === 'POST',
  new NetworkFirst({
    cacheName: 'nostr-publish-api-runtime', // Runtime cache for the API response itself if needed
    plugins: [nostrPublishQueue]
  })
);

// Map Tiles Caching (example, can also be in workbox-config.cjs for generateSW)
registerRoute(
  ({url}) => url.href.includes('tile.openstreetmap.org') || url.href.includes('tile.thunderforest.com'),
  new CacheFirst({
    cacheName: 'map-tiles',
    plugins: [
      new ExpirationPlugin({ maxEntries: 500, maxAgeSeconds: 30 * 24 * 60 * 60 }), // 30 Days
      { cacheableResponse: { statuses: [0, 200] } } // Cache opaque responses for tiles
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
