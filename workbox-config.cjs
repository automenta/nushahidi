module.exports = {
  swSrc: 'src/sw.js',
  swDest: 'dist/sw.js',
  globDirectory: 'dist/',
  globPatterns: [
    '**/*.{html,js,css,png,jpg,json,woff2,svg}'
  ],
  ignoreURLParametersMatching: [
    /^utm_/,
    /^fbclid$/
  ],
  runtimeCaching: [
    {
      urlPattern: /^https:\/\/api\.nostr\.build\/.*/,
      handler: 'NetworkFirst',
      options: {
        cacheName: 'nostr-build-api',
        expiration: {
          maxEntries: 10,
          maxAgeSeconds: 24 * 60 * 60,
        },
        networkTimeoutSeconds: 10,
      }
    }
  ]
};
