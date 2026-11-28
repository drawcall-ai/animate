// Copies Jean Phil's model, which is not committed, into public/: `pnpm data <dir>` copies jean-phil.glb from `dir`, such as the
// public folder of the face example in the @drawcall/rig repository.
import { copyFileSync, existsSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const from = process.argv[2]
const to = join(dirname(fileURLToPath(import.meta.url)), "../public/jean-phil.glb")
if (!from || !existsSync(join(from, "jean-phil.glb"))) {
  console.error("pass the folder holding jean-phil.glb: `pnpm data <dir>`, such as @drawcall/rig's examples/face/public")
  process.exit(1)
}
copyFileSync(join(from, "jean-phil.glb"), to)
console.log(`copied jean-phil.glb from ${from}`)
