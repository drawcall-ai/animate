import type { Body, Story } from '@drawcall/animate'
import { flat, type Grip } from '@drawcall/hand'
import { type Object3D, Vector3 } from 'three'
import { type Ball, arc, letGo } from './court'

const degrees = (angle: number) => (angle * Math.PI) / 180
const place = (x: number, y: number, z: number) => new Vector3(x, y, z)
/** where he jumps from, ahead of where he starts (m) */
const SPOT = 1.5
/** the guide hand's palm faces the ball from the side */
const SIDE = place(-1, 0, 0)

/** A couple of steps in and a jump shot, the ball `held` in the right hand, which shoots, and the left steadies it from its side until it goes. The right lets the ball go above the head at the top of the jump, on its way to the ring 52° up. */
export function* jumpShot(body: Body, ball: Ball, drawn: Object3D, held: Grip): Story {
  // the ball is carried in front of the chest, the open left hand at its side
  body.hand.right.to(place(0.1, -0.2, 0.3), { on: body, palm: place(0, 1, 0) })
  body.hand.left.to(place(-0.1, -0.12, 0.3), { on: body, palm: SIDE })
  body.hand.right.shape(held.pose)
  body.hand.left.shape(flat)
  body.walk(SPOT)
  // he jumps as he gets there, and at the top the hand lets go above and in front of the shoulder, the ball on its way to the ring
  body.jump(place(0, body.size.stand + 0.35, SPOT + 0.15))
  // the left hand goes up with the ball, beside it, and stays behind as the right sends it off
  body.hand.left.by(body.highest(), place(-0.12, 0.35, 0.15), { on: body, palm: SIDE })
  const flying = arc(place(-0.1, 2.4, SPOT + 0.4), degrees(52))
  body.hand.right.shape(flat, { by: body.highest() })
  yield* body.hand.right.by(body.highest(), place(0, 0.45, 0.15), { velocity: flying, on: body, with: held })
  letGo(ball, drawn, flying)
  body.hand.left.free()

  yield* body.stand()
}
