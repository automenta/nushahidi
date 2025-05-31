import {defineConfig} from 'vite';

export default defineConfig({
  build: {
    sourcemap: false,
    rollupOptions: {
      output: {
        // manualChunks: undefined, // This is Vite's default behavior, can be removed
      },
    },
  },
  optimizeDeps: {
    exclude: ['nostr-tools/relay'], // Exclude nostr-tools/relay from pre-bundling
  },
  // publicDir: 'public' // This is Vite's default behavior, can be removed
});
