import { cache } from "@drawcall/cache/vite"
import { defaultClientConditions, defaultServerConditions, defineConfig } from "vite"

// @drawcall/rig skins in WebAssembly workers, in parallel only on a page isolated across origins.
const headers = { "Cross-Origin-Opener-Policy": "same-origin", "Cross-Origin-Embedder-Policy": "require-corp" }

export default defineConfig({
  // @drawcall/animate runs from its sources in this workspace (its `source` export condition), in the page and in Node
  resolve: { conditions: ["source", ...defaultClientConditions] },
  ssr: { resolve: { conditions: ["source", ...defaultServerConditions] } },
  // the cache plugin finds the loads of Jean Phil's rig and of each line's alignment in the source and computes them in Node,
  // into public/_cache; the page reads them
  plugins: [cache()],
  server: { headers },
  preview: { headers },
  build: { target: "es2023" },
})
