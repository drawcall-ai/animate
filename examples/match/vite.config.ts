import basicSsl from "@vitejs/plugin-basic-ssl"
import { defaultClientConditions, defaultServerConditions, defineConfig } from "vite"
import { vitecache } from "vitecache/vite"

// @drawcall/rig skins in WebAssembly workers, in parallel only on a page isolated across origins, and finds its
// workers beside its own modules, which prebundling would move.
const headers = { "Cross-Origin-Opener-Policy": "same-origin", "Cross-Origin-Embedder-Policy": "require-corp" }

export default defineConfig({
  // @drawcall/animate runs from its sources in this workspace (its `source` export condition), in the page and in the tests
  resolve: { conditions: ["source", ...defaultClientConditions] },
  ssr: { resolve: { conditions: ["source", ...defaultServerConditions] } },
  // vitecache finds the example's loads of a character, such as `new CachedSoldierLoader().loadAsync()`, and computes
  // the skin weights ahead, in Node, into the example's public/_vitecache; the browser reads them. The tests compute
  // them themselves, or read what the plugin saved. HTTPS=1 serves with a self-signed certificate: off localhost the rig
  // needs a secure origin (it hashes with crypto.subtle, and the isolation headers are ignored without one).
  plugins: process.env.VITEST ? [] : [vitecache(), ...(process.env.HTTPS ? [basicSsl()] : [])],
  // a test on a cold cache computes the skin weights first, which takes minutes
  test: { testTimeout: 1_200_000 },
  server: { headers },
  preview: { headers },
  // and what it brings that is not an ES module still has to be bundled for the browser
  optimizeDeps: { exclude: ["@drawcall/rig"], include: ["vitecache > safe-stable-stringify"] },
})
