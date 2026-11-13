import type { Body, Story } from 'animate-2d'
import { Vector3 } from 'three'
import { type Ball, RADIUS } from './ball'

/** where the last foot of the run-up comes down, short of the ball (m) */
const TAKEOFF = 3.9
/** where the hips are from the ball as the hand meets it: below it by the trunk and an arm stretched up, and a little behind (m) */
const UNDER = { below: 1.02, behind: 0.25 }
/** how the palm goes through the ball: down over the net (m/s) */
const HIT = new Vector3(0, -2, 12)

/** a short run-up, a jump, and the right hand through the ball at the top of it */
export function* spike(body: Body, ball: Ball): Story {
  body.hand.right.shape('flat')
  body.run({ speed: 3.5, at: TAKEOFF })
  body.jump({ x: 0, y: ball.position.y - UNDER.below, z: ball.position.z - UNDER.behind })
  // the palm meets the ball on the side it is hit from, facing the way it goes
  const behind = ball.position.clone().addScaledVector(HIT, -RADIUS / HIT.length())
  yield* body.hand.right.by(body.highest(), behind, { velocity: HIT, with: 'palm', palm: HIT })
  ball.velocity = HIT.clone()
  yield* body.stand()
}
