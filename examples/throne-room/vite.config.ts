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
  // (the film, 150 s of the scene stepped headless, takes ~50 s on an M-series laptop and 129 s on the CI runner, measured)
  test: { testTimeout: 300_000 },
});
