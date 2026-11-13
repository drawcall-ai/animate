import { Vector3 } from 'three'

/** `velocity` is none while it is in the hand */
export type Ball = { position: Vector3; velocity: Vector3 | null }

export const RADIUS = 0.108
/** how far below the wrist the middle of the ball hangs: the hand on top of it, the fingers in it (m) */
export const HANG = 0.19
/** where the foul line is, ahead of where the bowler starts, and how long and wide the lane is beyond it (m) */
export const LINE = 4.5
export const LANE = { length: 18.3, width: 1.05 }
const GRAVITY = 9.81
/** how much of its speed a rolling ball loses in a second */
const DRAG = 0.04

export const ball = (): Ball => ({ position: new Vector3(), velocity: null })

/** where the wrist is as the hand lets the ball go `ahead` of the origin (m), in the line of a right arm: the ball just clear of the boards */
export const release = (ahead: number) => new Vector3(-0.2, RADIUS + HANG + 0.02, ahead)

/** in the hand it hangs from the wrist; let go, it drops onto the boards and rolls on down the lane, to its end */
export function carry(b: Ball, hand: Vector3, dt: number) {
  if (!b.velocity) {
    b.position.copy(hand).y -= HANG
    return
  }
  if (b.position.z >= LINE + LANE.length) return
  b.velocity.y -= GRAVITY * dt
  b.position.addScaledVector(b.velocity, dt)
  if (b.position.y > RADIUS) return
  b.position.y = RADIUS
  b.velocity.y = 0
  b.velocity.multiplyScalar(1 - DRAG * dt)
}
