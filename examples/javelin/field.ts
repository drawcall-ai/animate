import type { Statement } from '@drawcall/hand'
import { CylinderGeometry, Mesh, MeshStandardMaterial, type Object3D, Vector3 } from 'three'

/** `velocity` is none while it is in the hand; `angle` is how far up from level it points (rad) */
export type Javelin = { position: Vector3; velocity: Vector3 | null; angle: number; landed: boolean }

/** how far its ends are from where it is held (m) */
export const LENGTH = { ahead: 1.05, behind: 1.55 }
/** how thick its shaft is: its radius (m) */
export const THICK = 0.012
/** the palm under the shaft where it is held, the fingers round it */
export const GRIP: Statement = { at: new Vector3(0, -THICK, 0), from: new Vector3(0, -1, 0) }
const GRAVITY = 9.81

/** its shaft, laid along z from where it is held: a cylinder stands along y */
export function shaft() {
  const drawn = new Mesh(
    new CylinderGeometry(THICK, THICK, LENGTH.ahead + LENGTH.behind),
    new MeshStandardMaterial({ color: 0xffd060 }),
  )
  drawn.geometry.rotateX(Math.PI / 2)
  drawn.geometry.translate(0, 0, (LENGTH.ahead - LENGTH.behind) / 2)
  return drawn
}

export const javelin = (): Javelin => ({ position: new Vector3(), velocity: null, angle: 0.5, landed: false })

/** an end of the javelin, `along` it from where it is held (m) */
export const end = (j: Javelin, along: number) =>
  j.position.clone().add(new Vector3(0, Math.sin(j.angle) * along, Math.cos(j.angle) * along))

/** it leaves the hand that holds it, moving so */
export function letGo(j: Javelin, held: Object3D, velocity: Vector3) {
  held.updateWorldMatrix(true, false)
  held.getWorldPosition(j.position)
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
