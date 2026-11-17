// The grips the tests sweep: every thing, held at points all through it, from every side, in each kind of grip
// the example offers, the fingers left out starting relaxed, spread wide or in a fist.
import { type HandPart, HandPose } from "@drawcall/animate"
import { Box3, Group, Vector3 } from "three"
import { THINGS } from "../src/things"

const KINDS: Record<string, readonly HandPart[] | undefined> = { whole: undefined, pinch: ["thumb", "index", "middle"], tip: ["index"] }
const wide = (spread: number) => ({ spread, bend: [0, 0, 0] as [number, number, number] })
const STARTS: Record<string, HandPose> = {
  relaxed: HandPose.relaxed,
  wide: { thumb: wide(0.5), index: wide(0.35), middle: wide(0), ring: wide(-0.35), little: wide(-0.35) },
  fist: HandPose.fist,
}
/** where on a thing, as shares of its half size from its middle: in it, off to each side, and out at two corners */
const POINTS = [
  [0, 0, 0],
  [0.6, 0, 0],
  [-0.6, 0, 0],
  [0, 0.6, 0],
  [0, -0.6, 0],
  [0, 0, 0.6],
  [0, 0, -0.6],
  [0.9, 0.9, 0.9],
  [-0.9, 0.5, -0.9],
]
/** the 26 sides: along each axis, and between them */
const SIDES: Vector3[] = []
for (const x of [-1, 0, 1]) for (const y of [-1, 0, 1]) for (const z of [-1, 0, 1]) if (x || y || z) SIDES.push(new Vector3(x, y, z).normalize())

export type Case = {
  name: string
  thing: string
  kind: string
  at: Vector3
  approachFrom: Vector3
  thumbToward: Vector3
  using?: readonly HandPart[]
  idlePose: HandPose
}

/** the thumb to the thing's +y side, or +z where the hand comes along y */
export const thumbFor = (from: Vector3) => (Math.abs(from.y) < 0.9 ? new Vector3(0, 1, 0) : new Vector3(0, 0, 1))

/** every `stride`th of the grips: all 11,466 of them with 1 */
export function cases(stride: number): Case[] {
  const all: Case[] = []
  for (const thing of Object.keys(THINGS)) {
    const box = new Box3().setFromObject(THINGS[thing]())
    const [half, middle] = [box.getSize(new Vector3()).multiplyScalar(0.5), box.getCenter(new Vector3())]
    for (const [p, point] of POINTS.entries())
      for (const [s, from] of SIDES.entries())
        for (const [kind, using] of Object.entries(KINDS))
          for (const [held, start] of Object.entries(STARTS)) {
            if (kind === "whole" && held !== "relaxed") continue // nothing is left out
            const at = new Vector3(...point).multiply(half).add(middle)
            all.push({ name: `${thing} p${p} s${s} ${kind} ${held}`, thing, kind, at, approachFrom: from, thumbToward: thumbFor(from), using, idlePose: start })
          }
  }
  return all.filter((_, i) => i % stride === 0)
}

/** a thing as the example has it, set somewhere in the world and turned */
export function placed(thing: string) {
  const group = new Group().add(THINGS[thing]())
  group.position.set(0.1, 1.1, -0.2)
  group.rotation.set(0.3, 0.5, 0.2)
  group.updateMatrixWorld(true)
  return group
}
