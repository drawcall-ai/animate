import { Vector3 } from 'three'

/** `velocity` is none while it is in the hand */
export type Ball = { position: Vector3; velocity: Vector3 | null }

export const RADIUS = 0.12
/** where the middle of the ball is from the wrist of the hand under it (m) */
const HELD = new Vector3(0, 0.14, 0.06)
/** where the middle of the ring is, in the line of a right hand, above the floor and ahead of where the shooter starts, and how wide it is (m) */
export const HOOP = { x: -0.1, y: 3.05, z: 6, radius: 0.225 }
const GRAVITY = 9.81

export const ball = (): Ball => ({ position: new Vector3(), velocity: null })

/** how a ball leaves a place `up` from level (rad) to come down through the middle of the ring */
export function arc(from: Vector3, up: number) {
  const [far, rise] = [HOOP.z - from.z, HOOP.y - from.y]
  const speed = Math.sqrt((GRAVITY * far * far) / (2 * Math.cos(up) ** 2 * (far * Math.tan(up) - rise)))
  return new Vector3(0, speed * Math.sin(up), speed * Math.cos(up))
}

/** in the hand it lies on it; let go, it flies, and bounces on the floor until it lies still */
export function carry(b: Ball, hand: Vector3, dt: number) {
  if (!b.velocity) {
    b.position.copy(hand).add(HELD)
    return
  }
  if (b.velocity.lengthSq() === 0) return
  b.velocity.y -= GRAVITY * dt
  b.position.addScaledVector(b.velocity, dt)
  if (b.position.y > RADIUS || b.velocity.y > 0) return
  b.position.y = RADIUS
  b.velocity.y = b.velocity.y < -0.8 ? -0.7 * b.velocity.y : 0
  b.velocity.multiplyScalar(1 - 0.5 * dt)
  if (b.velocity.length() < 0.05) b.velocity.set(0, 0, 0)
}
