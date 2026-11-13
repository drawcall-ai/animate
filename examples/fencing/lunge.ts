import type { Body, Story } from 'animate-2d'
import { Vector3 } from 'three'
import { type Target, touching } from './target'

/** how far apart his feet stand en garde, and in the lunge (m) */
const APART = { guard: 0.5, lunge: 1.1 }
/** how far ahead of the hips the sword hand is at the touch (m), and how fast it is going (m/s) */
const THRUST = { ahead: 0.5, speed: 3 }
/** the sword hand en garde, from its shoulder: the elbow bent, the hand ahead at the height of the chest */
const READY = { x: 0, y: -0.25, z: 0.35 }
/** the blade at the touch: up and in, from the hand low on his right to the middle of the target */
const BLADE = new Vector3(0.15, 0.4, 1)
/** the back hand, from its shoulder: down behind him, the arm all but straight */
const BEHIND = { x: 0.2, y: -0.5, z: -0.25 }

/** A right-handed fencer comes en garde, advances two steps, lunges to touch the target with the point, and recovers to en garde. */
export function* lunge(body: Body, target: Target): Story {
  const touch = touching(target, BLADE)
  // where the back foot stands for the lunge to end with the point on the target
  const back = touch.z - THRUST.ahead - APART.lunge / 2

  body.hand.right.shape({ around: 0.02 })
  body.hand.right.to(READY, { on: body })
  body.hand.left.to(BEHIND, { on: body })
  yield* body.foot.right.to(body.ground('right', body.foot.left.value.z + APART.guard))

  // the advance: the front foot steps, and the back foot after it
  for (const z of [back / 2, back]) {
    yield* body.foot.right.to(body.ground('right', z + APART.guard))
    yield* body.foot.left.to(body.ground('left', z))
  }

  // the lunge: the front foot goes far out, and the point to the touch as the hips come after it
  const out = body.foot.right.to(body.ground('right', back + APART.lunge))
  yield* body.hand.right.to(touch, { velocity: { x: 0, y: 0, z: THRUST.speed }, with: 'grip', pointing: BLADE })
  yield* out

  // the recovery: the front foot comes back, and the hand
  const ready = body.hand.right.to(READY, { on: body })
  yield* body.foot.right.to(body.ground('right', back + APART.guard))
  yield* ready
  yield* body.stand()
}
