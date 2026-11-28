import { defineConfig } from "tsdown"

// The package is the workspace's private packages put together: their code and their types are bundled into dist, so
// the published package depends on three and, for speech, a pronouncing dictionary and the optional peers that align.
export default defineConfig({
  // the aligner is its own entry, chosen by the `#align` import condition: Node gets the speech model, browsers a stub
  entry: { index: "src/index.ts", "align/node": "../speech/src/align/node.ts", "align/browser": "../speech/src/align/browser.ts" },
  platform: "neutral",
  target: "es2023",
  sourcemap: true,
  // eager: the private packages' declarations are emitted from their sources, which this tsconfig does not include;
  // what they mark @internal is theirs alone and is left out
  dts: { tsc: { eager: true }, compilerOptions: { stripInternal: true } },
  deps: { alwaysBundle: [/^@drawcall\/(ik|humanoid|hand|locomotion|face|speech)$/], neverBundle: ["#align", /^node:/] },
})
