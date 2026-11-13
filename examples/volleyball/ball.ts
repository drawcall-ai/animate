import { Vector3 } from 'three'

/** `velocity` is none while it hangs in the air */
export type Ball = { position: Vector3; velocity: Vector3 | null }

export const RADIUS = 0.105
/** where the net stands ahead of where the hitter starts, and how high its top edge is (m) */
export const NET = { z: 5.75, y: 2.24 }
/** where the wrist is from the middle of the ball as the hand meets it: behind and a little under it (m) */
export const PALM = new Vector3(0, -0.05, -0.15)
const GRAVITY = 9.81

/** a ball hanging on the hitter's side of the net, in the line of a right hand */
export const ball = (): Ball => ({ position: new Vector3(-0.2, 2.64, 4.8), velocity: null })

/** it hangs until it is hit; then it flies, and bounces on the floor until it lies still */
export function fly(b: Ball, dt: number) {
  if (!b.velocity || b.velocity.lengthSq() === 0) return
  b.velocity.y -= GRAVITY * dt
  b.position.addScaledVector(b.velocity, dt)
  if (b.position.y > RADIUS || b.velocity.y > 0) return
  b.position.y = RADIUS
  b.velocity.y = b.velocity.y < -0.8 ? -0.7 * b.velocity.y : 0
  b.velocity.multiplyScalar(1 - 0.5 * dt)
  if (b.velocity.length() < 0.05) b.velocity.set(0, 0, 0)
}
