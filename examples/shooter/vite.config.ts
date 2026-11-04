import { defaultClientConditions, defaultServerConditions, defineConfig } from 'vite';
import { vitecache } from 'vitecache/vite';

// Shared memory lets rig's WASM solver use parallel workers.
const headers = { 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp' };

export default defineConfig({
  plugins: [vitecache()],
  // Preserve rig's worker URLs relative to its published modules.
  optimizeDeps: { exclude: ['@drawcall/rig'] },
  // Run the animation library from its source, in the browser and in the tests (which resolve through the server conditions).
  resolve: { conditions: ['source', ...defaultClientConditions] },
  ssr: { resolve: { conditions: ['source', ...defaultServerConditions] } },
  server: { port: 5289, strictPort: true, headers },
  preview: { port: 5289, strictPort: true, headers },
  // (a test steps whole movements headless, 1–3 s each alone: it is given the time it takes on a loaded machine, not vitest's 5 s)
  test: { testTimeout: 30_000 },
});
