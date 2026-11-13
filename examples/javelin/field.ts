import { Vector3 } from 'three'

/** `velocity` is none while it is in the hand; `angle` is how far up from level it points (rad) */
export type Javelin = { position: Vector3; velocity: Vector3 | null; angle: number; landed: boolean }

export const LENGTH = { ahead: 1.05, behind: 1.55 }
const GRAVITY = 9.81

export const javelin = (): Javelin => ({ position: new Vector3(), velocity: null, angle: 0.5, landed: false })

/** an end of the javelin, `along` it from where it is held (m) */
export const end = (j: Javelin, along: number) =>
  j.position.clone().add(new Vector3(0, Math.sin(j.angle) * along, Math.cos(j.angle) * along))

/** in the hand it goes where the hand goes; let go, it flies point first until its point comes down */
export function carry(j: Javelin, hand: Vector3, dt: number) {
  if (!j.velocity) {
    j.position.copy(hand)
    return
  }
  if (j.landed) return
  j.velocity.y -= GRAVITY * dt
  j.position.addScaledVector(j.velocity, dt)
  j.angle = Math.atan2(j.velocity.y, j.velocity.z)
  j.landed = end(j, LENGTH.ahead).y <= 0
}
