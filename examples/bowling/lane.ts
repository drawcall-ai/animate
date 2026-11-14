import type { Statement } from '@drawcall/hand'
import { Mesh, MeshStandardMaterial, type Object3D, SphereGeometry, Vector3 } from 'three'

/** `velocity` is none while it is in the hand */
export type Ball = { position: Vector3; velocity: Vector3 | null }

export const RADIUS = 0.108
/** the palm under the ball and the fingers up its side: the thumb does not reach round a ball so big */
export const GRIP: Statement = {
  at: new Vector3(0, -RADIUS, 0),
  from: new Vector3(0, -1, 0),
  using: ['palm', 'index', 'middle', 'ring', 'little'],
}
/** where the foul line is, ahead of where the bowler starts, and how long and wide the lane is beyond it (m) */
export const LINE = 4.5
export const LANE = { length: 18.3, width: 1.05 }
const GRAVITY = 9.81
/** how much of its speed a rolling ball loses in a second */
const DRAG = 0.04

export const sphere = () => new Mesh(new SphereGeometry(RADIUS), new MeshStandardMaterial({ color: 0x3060c0 }))

export const ball = (): Ball => ({ position: new Vector3(), velocity: null })

/** where the middle of the ball is as the hand lets it go `ahead` of the origin (m), in the line of a right arm: a hand above the boards */
export const release = (ahead: number) => new Vector3(-0.2, RADIUS + 0.09, ahead)

/** it leaves the hand that holds it, moving so */
export function letGo(b: Ball, held: Object3D, velocity: Vector3) {
  held.updateWorldMatrix(true, false)
  held.getWorldPosition(b.position)
  b.velocity = velocity.clone()
}

/** let go, it drops onto the boards and rolls on down the lane, to its end */
export function roll(b: Ball, dt: number) {
  if (!b.velocity || b.position.z >= LINE + LANE.length) return
  b.velocity.y -= GRAVITY * dt
  b.position.addScaledVector(b.velocity, dt)
  if (b.position.y > RADIUS) return
  b.position.y = RADIUS
  b.velocity.y = 0
  b.velocity.multiplyScalar(1 - DRAG * dt)
}
