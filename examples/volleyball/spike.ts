import type { Body, Story } from 'animate-2d'
import { type Ball, PALM } from './ball'

/** where the last foot of the run-up comes down, short of the ball (m) */
const TAKEOFF = 3.9
/** where the hips are from the ball as the hand meets it: below it by the trunk and an arm stretched up, and a little behind (m) */
const UNDER = { below: 1.02, behind: 0.25 }

/** a short run-up, a jump, and the right hand through the ball at the top of it */
export function* spike(body: Body, ball: Ball): Story {
  body.run({ speed: 3.5, at: TAKEOFF })
  body.jump({ x: 0, y: ball.position.y - UNDER.below, z: ball.position.z - UNDER.behind })
  yield* body.hand.right.by(body.highest(), ball.position.clone().add(PALM), { velocity: { x: 0, y: -2, z: 12 } })
  ball.velocity = body.hand.right.velocity.clone()
  yield* body.stand()
}
