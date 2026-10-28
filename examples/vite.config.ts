import { defaultClientConditions, defaultServerConditions, defineConfig } from 'vite';
import { vitecache } from 'vitecache/vite';

// resolve the workspace package to its TypeScript source, so dev, build and vitest need no package build first
const source = 'source';
// Shared memory lets rig's WASM solver use parallel workers.
const headers = { 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp' };

export default defineConfig({
  plugins: [vitecache()],
  // Preserve rig's worker URLs relative to its published modules.
  optimizeDeps: { exclude: ['@drawcall/rig'] },
  resolve: { conditions: [source, ...defaultClientConditions] },
  // (bundled into the node benchmark from source, not imported from its dist)
  ssr: { resolve: { conditions: [source, ...defaultServerConditions] }, noExternal: ['@drawcall/animate'] },
  server: { port: 5287, strictPort: true, headers },
  preview: { port: 5287, strictPort: true, headers },
  // the benchmark page ships too, to measure on real devices
  build: { rollupOptions: { input: ['index.html', 'bench.html'] } },
});
