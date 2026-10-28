import { defineConfig } from 'vite';
import { vitecache } from 'vitecache/vite';

// Shared memory lets rig's WASM solver use parallel workers.
const headers = { 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp' };

export default defineConfig({
  plugins: [vitecache()],
  // Preserve rig's worker URLs relative to its published modules.
  optimizeDeps: { exclude: ['@drawcall/rig'] },
  server: { port: 5290, strictPort: true, headers },
  preview: { port: 5290, strictPort: true, headers },
  test: { testTimeout: 120_000 },
});
