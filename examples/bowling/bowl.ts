import type { Body, Story, Thing } from '@drawcall/animate'
import { flat, type Grip } from '@drawcall/hand'
import { Vector3 } from 'three'
import { LINE, RADIUS } from './lane'

const place = (x: number, y: number, z: number) => new Vector3(x, y, z)
/** where he carries the ball, from his right shoulder (of his arm): before his belly, the palm under it turned in as far as a forearm turns up */
const CARRY = { at: { x: 0.35, y: -0.45, z: 0.6 }, palm: place(0.7, 1, 0) }
/** a hand on each side of a ball turned the way he faces: the index does not reach round a ball so big */
const using = ['palm', 'middle', 'ring', 'little'] as const
export const SIDE = {
  left: { at: place(RADIUS, 0, 0), from: place(1, 0, 0), using },
  right: { at: place(-RADIUS, 0, 0), from: place(-1, 0, 0), using },
}
/** where his left foot comes down at the end of the approach: short of the foul line, in the line of the lane (m) */
const PLANT = { x: 0, z: LINE - 0.4 }
/** how fast he runs up, and how hard he brakes onto the left foot (m/s) */
const APPROACH = { speed: 3, arrive: 1 }
/** the ball leaves the hand beside the left foot, to its right and a little ahead, just over the boards, rolling down the lane (m, m/s) */
const RELEASE = { aside: -0.2, ahead: 0.1, over: 0.1, speed: 7 }
/**
 * He carries the `ball`, led by his right hand, on its palm before his belly, turned the way he faces, the left hand
 * on it by the grip `side`, on its left. The story is over once it is there.
 */
export function carry(body: Body, ball: Thing, side: Grip) {
  const { arm } = body.size
  const { x, y, z } = CARRY.at
  ball.on(body.hand.left, side)
  return ball.to(place(x * arm, y * arm, z * arm), { on: body, palm: CARRY.palm, pointing: place(0, 0, 1) })
}

/**
 * The approach and the delivery of the `ball`, bound to his right hand: he runs up and brakes onto the left foot short
 * of the foul line, and the ball, sent as he sets off, swings through beside that foot as the run ends, low and rolling
 * down the lane; `letGo` gives how fast it leaves to whatever owns it next.
 */
export function* bowl(body: Body, ball: Thing, letGo: (velocity: Vector3) => void): Story {
  body.run({ ...APPROACH, at: PLANT, plant: 'left' })
  ball.off(body.hand.left)
  body.hand.left.shape()
  const moment = body.when(PLANT)
  const release = place(PLANT.x + RELEASE.aside, RADIUS + RELEASE.over, PLANT.z + RELEASE.ahead)
  body.hand.right.shape(flat, { by: moment })
  yield* ball.by(moment, release, { velocity: place(0, 0, RELEASE.speed), palm: place(0, 0, 1) })
  letGo(ball.free())
  yield* body.stand()
}
