import { type Object3D, Vector3 } from 'three'

/** `velocity` is none while it is in the hand; `angle` is how far up from level it points (rad) */
export type Javelin = { position: Vector3; velocity: Vector3 | null; angle: number; landed: boolean }

/** how far its ends are from where it is held (m) */
export const LENGTH = { ahead: 1.05, behind: 1.55 }
/** how thick its shaft is: its radius (m) */
export const THICK = 0.012
const GRAVITY = 9.81

export const javelin = (): Javelin => ({ position: new Vector3(), velocity: null, angle: 0.5, landed: false })

/** an end of the javelin, `along` it from where it is held (m) */
export const end = (j: Javelin, along: number) =>
  j.position.clone().add(new Vector3(0, Math.sin(j.angle) * along, Math.cos(j.angle) * along))

/** it leaves the grip that holds it, moving so */
export function letGo(j: Javelin, grip: Object3D, velocity: Vector3) {
  grip.updateWorldMatrix(true, false)
  grip.getWorldPosition(j.position)
  j.velocity = velocity.clone()
  j.angle = Math.atan2(velocity.y, velocity.z)
}

/** let go, it flies point first until its point comes down */
export function fly(j: Javelin, dt: number) {
  if (!j.velocity || j.landed) return
  j.velocity.y -= GRAVITY * dt
  j.position.addScaledVector(j.velocity, dt)
  j.angle = Math.atan2(j.velocity.y, j.velocity.z)
  j.landed = end(j, LENGTH.ahead).y <= 0
}
