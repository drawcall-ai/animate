import type { Body, Story } from '@drawcall/animate'
import { flat, type Grip } from '@drawcall/hand'
import { type Object3D, Vector3 } from 'three'
import { LINE, RADIUS } from './lane'

const place = (x: number, y: number, z: number) => new Vector3(x, y, z)
/** where he carries the ball, from his right shoulder (of his arm): before his belly, the palm under it turned in as far as a forearm turns up */
const CARRY = { at: { x: 0.2, y: -0.45, z: 0.6 }, palm: place(0.7, 1, 0) }
/** where his left foot comes down at the end of the approach: short of the foul line, in the line of the lane (m) */
const PLANT = { x: 0, z: LINE - 0.4 }
/** how fast he runs up, and how hard he brakes onto the left foot (m/s) */
const APPROACH = { speed: 3, arrive: 1 }
/** the ball leaves the hand beside the left foot, to its right and a little ahead, just over the boards, rolling down the lane (m, m/s) */
const RELEASE = { aside: -0.2, ahead: 0.1, over: 0.1, speed: 7 }
const UP = place(0, 1, 0)

/**
 * The ball in his hands keeps its own turn, turned only as he faces, not as the wrist turns: called after each update
 * while it is bound. (A thing bound to a hand turns with it; one bound by a point alone sits off where the grip has it,
 * and a send `with` the grip is then not the ball's.)
 */
export function upright(ball: Object3D, body: Body) {
  ball.quaternion.setFromAxisAngle(UP, Math.atan2(body.facing.x, body.facing.z))
  ball.updateMatrix()
}

/** He carries the ball `seat`ed on his right palm before his belly, the left palm on its left side. */
export function* carry(body: Body, seat: Grip): Story {
  const { arm } = body.size
  const { x, y, z } = CARRY.at
  yield* body.hand.right.to(place(x * arm, y * arm, z * arm), { on: body, with: seat, palm: CARRY.palm })
  body.hand.left.to(place(RADIUS, 0, 0), { on: seat.target, with: 'palm', palm: place(-1, 0, 0) })
  body.hand.left.shape(flat)
}

/**
 * The approach and the delivery, the ball `seat`ed in his right hand: he runs up and brakes onto the left foot short of
 * the foul line, and the hand, sent as he sets off, swings the ball through beside that foot as the run ends, low and
 * rolling down the lane; `letGo` gives how fast it leaves to whatever owns it next.
 */
export function* bowl(body: Body, seat: Grip, letGo: (velocity: Vector3) => void): Story {
  body.run({ ...APPROACH, at: PLANT, plant: 'left' })
  body.hand.left.free()
  body.hand.left.shape()
  const moment = body.when(PLANT)
  const release = place(PLANT.x + RELEASE.aside, RADIUS + RELEASE.over, PLANT.z + RELEASE.ahead)
  body.hand.right.shape(flat, { by: moment })
  yield* body.hand.right.by(moment, release, { velocity: place(0, 0, RELEASE.speed), with: seat, palm: place(0, 0, 1) })
  letGo(body.hand.right.letGo())
  yield* body.stand()
}
