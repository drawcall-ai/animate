import type { Body, Held, Story } from '@drawcall/animate'
import { type Object3D, Vector3 } from 'three'
import { type Ball, butt, feed, strike, top } from './ball'

/** meeting the ball: the way the racket points, out to his right, its head up and a little behind the hand, and how the hand is moving, forward, up and a little across him (m/s) */
const MEET = { racket: new Vector3(-0.55, 0.3, -0.2), velocity: { x: 1.5, y: 3, z: 10 } }
/** where the left hand is from its shoulder through the stroke: out in front of him (m) */
const AHEAD = { x: -0.1, y: -0.15, z: 0.45 }

/** A right-hander hits a forehand at the top of the bounce of a ball that is fed to him, the racket `held` in his right hand: the left foot steps ahead, level with where the strings meet the ball, and the left hand is out in front. */
export function* forehand(body: Body, ball: Ball, racket: Object3D, held: Held): Story {
  feed(ball)
  const { seconds, at } = top(ball)
  body.foot.left.to(body.ground('left', at.z))
  body.hand.left.to(AHEAD, { on: body })
  yield* held.by(body.time + seconds, butt(at, MEET.racket), {
    velocity: MEET.velocity,
    pointing: MEET.racket,
  })
  strike(ball, racket, body)
  yield* body.stand()
}
