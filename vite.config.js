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
    include: ['nostr-tools'],
  },
  // publicDir: 'public'
});
