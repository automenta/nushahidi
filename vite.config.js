import {defineConfig} from 'vite';

export default defineConfig({
  build: {
    sourcemap: false,
    rollupOptions: {
      output: {
        // manualChunks: undefined,
      },
    },
  },
  optimizeDeps: {
    // Removed 'nostr-tools' from include to prevent potential bundling issues with subpath exports
    // include: ['nostr-tools'], 
  },
  // publicDir: 'public'
});
