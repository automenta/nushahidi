import { registerRoute } from 'workbox-routing';
import { NetworkOnly } from 'workbox-strategies';

self.addEventListener('install', event => {
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(clients.claim());
});
