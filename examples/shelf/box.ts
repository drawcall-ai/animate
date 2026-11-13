import type { Side } from '@drawcall/animate'
import { Vector3 } from 'three'

/** `held` while it is between the hands, where it lies against them; let go it has a `velocity` until it lies on something */
export type Box = { position: Vector3; velocity: Vector3; held?: Vector3 }

/** how wide (x), high and deep (z) the box is (m) */
export const BOX = { width: 0.34, height: 0.2, depth: 0.3 }
/** the shelf: how high its top is, about as high as his head, where its near edge is ahead of where he starts, and how deep and wide it is (m) */
export const SHELF = { top: 1.5, edge: 4.3, depth: 0.4, width: 0.9, thick: 0.03 }
/** how each hand has the box: the palm on its side, facing in */
export const PALM = {
  left: { with: 'palm', palm: { x: -1, y: 0, z: 0 } },
  right: { with: 'palm', palm: { x: 1, y: 0, z: 0 } },
} as const
const GRAVITY = 9.81

/** a box lying on the floor `ahead` of the origin (m) */
export const boxAt = (ahead: number): Box => ({
  position: new Vector3(0, BOX.height / 2, ahead),
  velocity: new Vector3(),
})

/** where the palm of a hand is that has a side of a box whose middle is at a place */
export const grip = (middle: Vector3, side: Side) =>
  middle.clone().setX(middle.x + (side === 'left' ? 1 : -1) * (BOX.width / 2))

/** the hands take the box where it lies between them, or with none let it go */
export function take(box: Box, left?: Vector3, right?: Vector3) {
  box.held = left && right && box.position.clone().sub(left.clone().add(right).multiplyScalar(0.5))
}

/** where the middle of the box is, lying on the shelf just inside its edge */
export const shelved = () => new Vector3(0, SHELF.top + BOX.height / 2, SHELF.edge + BOX.depth / 2 + 0.02)

/** where the middle of the box is short of the shelf, just high enough to go in over its edge */
export const clear = () => new Vector3(0, SHELF.top + BOX.height / 2 + 0.03, SHELF.edge - BOX.depth / 2 - 0.02)

/** what is under the middle of a box at `z`: the shelf or the floor (m up) */
const under = (z: number) => (z >= SHELF.edge && z <= SHELF.edge + SHELF.depth ? SHELF.top : 0)

/** held, it is between the two hands, where it lies against them; let go, it drops onto what is under it and lies there */
export function carry(box: Box, left: Vector3, right: Vector3, dt: number) {
  if (box.held) {
    box.position.addVectors(left, right).multiplyScalar(0.5).add(box.held)
    box.velocity.set(0, 0, 0)
    return
  }
  const rest = under(box.position.z) + BOX.height / 2
  if (box.position.y <= rest) return
  box.velocity.y -= GRAVITY * dt
  box.position.y = Math.max(rest, box.position.y + box.velocity.y * dt)
  if (box.position.y === rest) box.velocity.set(0, 0, 0)
}
