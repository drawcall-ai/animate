import { defaultClientConditions, defaultServerConditions, defineConfig } from 'vite';
import { vitecache } from 'vitecache/vite';

// resolve the workspace package to its TypeScript source, so dev, build and vitest need no package build first
const source = 'source';
// Shared memory lets rig's WASM solver use parallel workers.
const headers = { 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp' };

export default defineConfig({
  // Run the viewer before building to populate public/_vitecache; Vite includes it in the build.
  // Deploy with the same COOP/COEP headers to allow parallel rigging workers on cache misses.
  plugins: [vitecache()],
  // Preserve rig's worker URLs relative to its published modules.
  optimizeDeps: { exclude: ['@drawcall/rig'] },
  resolve: { conditions: [source, ...defaultClientConditions] },
  // (bundled into the node benchmark from source, not imported from its dist)
  ssr: { resolve: { conditions: [source, ...defaultServerConditions] }, noExternal: ['@drawcall/animate'] },
  server: { port: 5287, strictPort: true, headers },
  preview: { port: 5287, strictPort: true, headers },
});
