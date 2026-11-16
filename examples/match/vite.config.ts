import basicSsl from "@vitejs/plugin-basic-ssl"
import { defineConfig } from "vite"
import { vitecache } from "vitecache/vite"

// @drawcall/rig skins in WebAssembly workers, in parallel only on a page isolated across origins, and finds its
// workers beside its own modules, which prebundling would move.
const headers = { "Cross-Origin-Opener-Policy": "same-origin", "Cross-Origin-Embedder-Policy": "require-corp" }

export default defineConfig({
  // The tests compute the weights themselves. HTTPS=1 serves with a self-signed certificate: off localhost the rig
  // needs a secure origin (it hashes with crypto.subtle, and the isolation headers are ignored without one).
  plugins: process.env.VITEST ? [] : [vitecache(), ...(process.env.HTTPS ? [basicSsl()] : [])],
  server: { headers },
  preview: { headers },
  // and what it brings that is not an ES module still has to be bundled for the browser
  optimizeDeps: { exclude: ["@drawcall/rig"], include: ["vitecache > safe-stable-stringify"] },
})
