import { defineConfig } from "tsdown"

// The package is the workspace's private packages put together: their code and their types are bundled into dist,
// so the published package depends on nothing but three.
export default defineConfig({
  entry: ["src/index.ts"],
  platform: "neutral",
  target: "es2023",
  sourcemap: true,
  // eager: the private packages' declarations are emitted from their sources, which this tsconfig does not include;
  // what they mark @internal is theirs alone and is left out
  dts: { tsc: { eager: true }, compilerOptions: { stripInternal: true } },
  deps: { alwaysBundle: [/^@drawcall\/(ik|humanoid|hand|locomotion)$/] },
})
