import type { Side } from '@drawcall/animate'
import { flat, type Statement } from '@drawcall/hand'
import { BoxGeometry, Mesh, Vector3 } from 'three'

/** a box: drawn, whether he holds it, and how it falls once let go until it lies on something */
export type Box = { mesh: Mesh; held: boolean; velocity: Vector3 }

/** how wide (x), high and deep (z) the box is (m) */
export const BOX = { width: 0.34, height: 0.2, depth: 0.3 }
/** the shelf: how high its top is, about as high as his head, where its near edge is ahead of where he starts, and how deep and wide it is (m) */
export const SHELF = { top: 1.5, edge: 4.3, depth: 0.4, width: 0.9, thick: 0.03 }
/** how each hand has the box: the palm and the fingers flat on its side, the left on its +x side and the right on its -x */
export const PALM: Record<Side, Statement> = {
  left: { at: new Vector3(BOX.width / 2, 0, 0), from: new Vector3(1, 0, 0), using: ['palm', 'index', 'middle', 'ring', 'little'], start: flat },
  right: { at: new Vector3(-BOX.width / 2, 0, 0), from: new Vector3(-1, 0, 0), using: ['palm', 'index', 'middle', 'ring', 'little'], start: flat },
}
const GRAVITY = 9.81

/** a box lying on the floor `ahead` of the origin (m) */
export function boxAt(ahead: number): Box {
  const mesh = new Mesh(new BoxGeometry(BOX.width, BOX.height, BOX.depth))
  mesh.position.set(0, BOX.height / 2, ahead)
  return { mesh, held: false, velocity: new Vector3() }
}

/** where the middle of the box is, lying on the shelf just inside its edge */
export const shelved = () => new Vector3(0, SHELF.top + BOX.height / 2, SHELF.edge + BOX.depth / 2 + 0.02)

/** where the middle of the box is short of the shelf, just high enough to go in over its edge */
export const clear = () => new Vector3(0, SHELF.top + BOX.height / 2 + 0.03, SHELF.edge - BOX.depth / 2 - 0.02)

/** what is under the middle of a box at `z`: the shelf or the floor (m up) */
const under = (z: number) => (z >= SHELF.edge && z <= SHELF.edge + SHELF.depth ? SHELF.top : 0)

/** let go, it drops onto what is under it and lies there */
export function fall({ mesh, held, velocity }: Box, dt: number) {
  const rest = under(mesh.position.z) + BOX.height / 2
  if (held || mesh.position.y <= rest) return
  velocity.y -= GRAVITY * dt
  mesh.position.y = Math.max(rest, mesh.position.y + velocity.y * dt)
  if (mesh.position.y === rest) velocity.set(0, 0, 0)
}
