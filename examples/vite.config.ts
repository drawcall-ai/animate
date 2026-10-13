import { defaultClientConditions, defaultServerConditions, defineConfig } from 'vite';

// resolve the workspace package to its TypeScript source, so dev, build and vitest need no package build first
const source = 'source';

export default defineConfig({
  resolve: { conditions: [source, ...defaultClientConditions] },
  // (bundled into the node benchmark from source, not imported from its dist)
  ssr: { resolve: { conditions: [source, ...defaultServerConditions] }, noExternal: ['@drawcall/animate'] },
  server: { port: 5287, strictPort: true },
  preview: { port: 5287, strictPort: true },
  // the benchmark page ships too, to measure on real devices
  build: { rollupOptions: { input: ['index.html', 'bench.html'] } },
});
