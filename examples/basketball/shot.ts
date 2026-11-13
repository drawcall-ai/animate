import { type Body, STAND, type Story } from 'animate-2d'
import { Vector3 } from 'three'
import { type Ball, arc } from './court'

const degrees = (angle: number) => (angle * Math.PI) / 180
const place = (x: number, y: number, z: number) => new Vector3(x, y, z)
/** where he jumps from, ahead of where he starts (m) */
const SPOT = 1.5

/** A couple of steps in and a jump shot: the right hand shoots and the left steadies the ball from its side until it goes. The right lets the ball go above the head at the top of the jump, on its way to the ring 52° up. */
export function* jumpShot(body: Body, ball: Ball): Story {
  // the ball is carried in front of the chest in both hands
  body.hand.right.to(place(0.1, -0.2, 0.3), { carried: true })
  body.hand.left.to(place(-0.1, -0.25, 0.3), { carried: true })
  body.walk(SPOT)
  // he jumps as he gets there, and at the top the hand lets go above and in front of the shoulder, the ball on its way to the ring
  body.jump(place(0, STAND + 0.35, SPOT + 0.15))
  // the left hand goes up with the ball, beside it, and stays behind as the right sends it off
  body.hand.left.by(body.highest(), place(-0.12, 0.35, 0.15), { carried: true })
  const flying = arc(place(-0.1, 2.4, SPOT + 0.4), degrees(52))
  yield* body.hand.right.by(body.highest(), place(0, 0.45, 0.15), { velocity: flying, carried: true })
  ball.velocity = body.hand.right.velocity.clone()
  body.hand.left.free()

  yield* body.stand()
}
