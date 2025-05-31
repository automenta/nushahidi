module.exports = {
  globDirectory: 'dist/',
  globPatterns: [
    '**/*.{html,js,css,png,jpg,json,woff2,svg}'
  ],
  swDest: 'dist/sw.js',
  ignoreURLParametersMatching: [
    /^utm_/,
    /^fbclid$/
  ],
  // Define runtime caching rules here if needed beyond precaching
  // For example, for map tiles if not covered by sw.js's registerRoute
  runtimeCaching: [
    {
      urlPattern: /^https:\/\/api\.nostr\.build\/.*/,
      handler: 'NetworkFirst',
      options: {
        cacheName: 'nostr-build-api',
        expiration: {
          maxEntries: 10,
          maxAgeSeconds: 24 * 60 * 60, // 1 day
        },
        networkTimeoutSeconds: 10,
      }
    },
    {
      urlPattern: ({url}) => url.href.includes('tile.openstreetmap.org') || url.href.includes('tile.thunderforest.com') || url.href.includes('tile.stamen.com'),
      handler: 'CacheFirst',
      options: {
        cacheName: 'map-tiles',
        expiration: {
          maxEntries: 500,
          maxAgeSeconds: 30 * 24 * 60 * 60, // 30 days
        },
        cacheableResponse: {
          statuses: [0, 200],
        },
      },
    }
  ]
};
