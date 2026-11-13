import type { Body, Side, Story } from 'animate-2d'
import { SIZE } from 'animate-2d'
import { type Target, touching } from './target'

/** how far apart his feet stand en garde, and in the lunge (m) */
const APART = { guard: 0.5, lunge: 1.1 }
/** how far ahead of the hips the sword hand is at the touch (m), and how fast it is going (m/s) */
const THRUST = { ahead: 0.5, speed: 3 }
/** the sword hand en garde, from its shoulder: the elbow bent, the hand ahead at the height of the chest */
const READY = { x: 0, y: -0.25, z: 0.35 }
/** the back hand, from its shoulder: down behind him, the arm all but straight */
const BEHIND = { x: 0.2, y: -0.5, z: -0.25 }

/** where a foot stands on the ground, so far along */
const stands = (side: Side, z: number) => ({ x: side === 'left' ? SIZE.hip : -SIZE.hip, y: SIZE.ankle, z })

/** A right-handed fencer comes en garde, advances two steps, lunges to touch the target with the point, and recovers to en garde. */
export function* lunge(body: Body, target: Target): Story {
  const touch = touching(target)
  // where the back foot stands for the lunge to end with the point on the target
  const back = touch.z - THRUST.ahead - APART.lunge / 2

  body.hand.right.to(READY, { carried: true })
  body.hand.left.to(BEHIND, { carried: true })
  yield* body.foot.right.to(stands('right', body.foot.left.value.z + APART.guard))

  // the advance: the front foot steps, and the back foot after it
  for (const z of [back / 2, back]) {
    yield* body.foot.right.to(stands('right', z + APART.guard))
    yield* body.foot.left.to(stands('left', z))
  }

  // the lunge: the front foot goes far out, and the hand to the touch as the hips come after it
  const out = body.foot.right.to(stands('right', back + APART.lunge))
  yield* body.hand.right.to(touch, { velocity: { x: 0, y: 0, z: THRUST.speed } })
  yield* out

  // the recovery: the front foot comes back, and the hand
  const ready = body.hand.right.to(READY, { carried: true })
  yield* body.foot.right.to(stands('right', back + APART.guard))
  yield* ready
}
