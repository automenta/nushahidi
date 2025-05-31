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
    // Re-including 'nostr-tools' to ensure proper bundling and prevent internal SimplePool errors.
    include: ['nostr-tools'], 
  },
  // publicDir: 'public'
});
