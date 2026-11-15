import { defineConfig } from 'vite'
import { vitecache } from 'vitecache/vite'

// the rig is skinned by WebAssembly in workers, in parallel only on a page isolated across origins
const headers = { 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp' }

export default defineConfig({
  plugins: [vitecache()],
  server: { headers },
  preview: { headers },
  // the game and the scripted story are both pages of it
  build: { rolldownOptions: { input: ['index.html', 'story.html'] } },
  // (its workers are found beside its own modules, which prebundling would move)
  // and what it brings that is not an ES module still has to be bundled for the browser
  optimizeDeps: { exclude: ['@drawcall/rig'], include: ['vitecache > safe-stable-stringify'] },
})
