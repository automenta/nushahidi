import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    sourcemap: false, // Set to false for "minified" feel, true for debugging
    rollupOptions: {
      output: {
        manualChunks: undefined, // Try to keep JS in one file for "consolidation"
      },
    },
  },
  // If sw.js is in root, ensure it's handled.
  // vite-plugin-pwa is better for this.
  // For manual workbox-cli, ensure publicDir is false if sw.js is not in public.
  publicDir: 'public', // Assuming sw.js will be generated into dist by workbox-cli
});
