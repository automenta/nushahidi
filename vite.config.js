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
    // Removed exclude for 'nostr-tools/relay' to allow Vite to handle it by default
  },
  // publicDir: 'public' // This is Vite's default behavior, can be removed
});
