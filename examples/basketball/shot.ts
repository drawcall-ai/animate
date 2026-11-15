import type { Body, Story } from '@drawcall/animate'
import { flat, type Grip, type Statement } from '@drawcall/hand'
import { Vector3 } from 'three'
import { RADIUS } from './ball'
import { HOOP, arc } from './court'

const place = (x: number, y: number, z: number) => new Vector3(x, y, z)
/** the right hand's palm under the ball, the fingers spread round it: where the ball sits in it, wherever it is */
export const SEAT: Statement = {
  at: place(0, -RADIUS, 0),
  from: place(0, -1, 0),
  using: ['palm', 'index', 'middle', 'ring', 'little'],
}
/** how steeply the ball leaves the hand, up from level (rad): a high arc drops into the ring */
const UP = (52 * Math.PI) / 180
/** how far he steps in toward the hoop before he jumps, and how far ahead the jump takes him (m) */
const STEP = { in: 0.8, on: 0.15 }
/** how nearly he faces the hoop before he steps in (the cosine of how far he is turned from it) */
const SQUARE = Math.cos((15 * Math.PI) / 180)
/** how high the jump lifts his hips above standing (of his leg) */
const JUMP = 0.4
/** the guide hand's palm faces the ball from its left side */
const SIDE = place(-1, 0, 0)

/**
 * Before his chest, as he carries the ball standing or into a shot: the ball on the right palm and the open left hand
 * at its side, the wrists counted from each shoulder (of his arm).
 */
export function carry(body: Body, seat: Grip) {
  const { arm } = body.size
  body.hand.right.to(place(0.18 * arm, -0.36 * arm, 0.55 * arm), { on: body, palm: place(0, 1, 0) })
  body.hand.left.to(place(-0.18 * arm, -0.22 * arm, 0.55 * arm), { on: body, palm: SIDE })
  body.hand.right.shape(seat.pose)
  body.hand.left.shape(flat)
}

/**
 * A jump shot from where he stands: carrying the ball he squares up to the hoop, steps in toward it and springs up, the left hand going
 * up beside the ball; at the top the right sends it off from above his shoulder on its way to the ring, and the ball
 * is let go moving so, which `letGo` gives to whatever owns it next. The arm swings on after it as he lands.
 */
export function* jumpShot(body: Body, seat: Grip, letGo: (velocity: Vector3) => void): Story {
  const { arm, leg, stand, trunk, shoulder } = body.size
  carry(body, seat)
  const from = body.hips.value
  const toward = new Vector3(HOOP.x - from.x, 0, HOOP.z - from.z).normalize()
  // (squared up to it first, for the steps in to go straight at it)
  body.face(toward)
  while (body.facing.dot(toward) < SQUARE) yield
  const spot = from.clone().addScaledVector(toward, STEP.in)
  body.walk({ x: spot.x, z: spot.z })
  const top = spot.addScaledVector(toward, STEP.on).setY(stand + JUMP * leg)
  body.jump(top)
  const highest = body.highest()
  body.hand.left.by(highest, place(-0.22 * arm, 0.64 * arm, 0.27 * arm), { on: body, palm: SIDE })
  // the ball leaves above and a little ahead of his right shoulder at the top (facing it, his right is -x)
  const right = new Vector3(-toward.z, 0, toward.x)
  const release = top
    .clone()
    .addScaledVector(right, shoulder)
    .addScaledVector(toward, 0.3 * arm)
    .setY(top.y + trunk + arm)
  const flying = arc(release, UP)
  body.hand.right.shape(flat, { by: highest })
  yield* body.hand.right.by(highest, release, { velocity: flying, with: seat })
  letGo(flying)
  body.hand.left.free()
  yield* body.stand()
}
