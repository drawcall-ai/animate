import { type Body, SIZE, type Story } from 'animate-2d'
import { Vector3 } from 'three'
import { type Ball, feed, held, strike, top } from './ball'

/** meeting the ball: where the right hand is from its shoulder, out to his right with the arm all but straight (m), and how it is moving, forward, up and a little across him: square to the arm (m/s) */
const MEET = { out: new Vector3(-0.55, -0.15, 0.15), velocity: { x: 1.5, y: 3, z: 10 } }
/** where the left hand is from its shoulder through the stroke: out in front of him (m) */
const AHEAD = { x: -0.1, y: -0.15, z: 0.45 }

/** A right-hander hits a forehand at the top of the bounce of a ball that is fed to him: the left foot steps ahead, level with where the strings meet the ball, and the left hand is out in front. */
export function* forehand(body: Body, ball: Ball): Story {
  feed(ball)
  const { seconds, at } = top(ball)
  body.foot.left.to({ x: SIZE.hip, y: SIZE.ankle, z: at.z })
  body.hand.left.to(AHEAD, { carried: true })
  yield* body.hand.right.by(body.time + seconds, held(at, MEET.out), { velocity: MEET.velocity })
  strike(ball, body)
  yield* body.stand()
}
