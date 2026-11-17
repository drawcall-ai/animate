import { defaultClientConditions, defaultServerConditions, defineConfig } from "vite"

// @drawcall/animate runs from its sources in this workspace (its `source` export condition), in the page and in the tests
export default defineConfig({
  resolve: { conditions: ["source", ...defaultClientConditions] },
  ssr: { resolve: { conditions: ["source", ...defaultServerConditions] } },
})
