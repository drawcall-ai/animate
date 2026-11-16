import type { Body, Side, Story, Thing } from '@drawcall/animate'
import { Vector3 } from 'three'
import { FOIL, type Target, touching } from './target'

/** how far apart his feet are en garde, and as the longest lunge lands (of his leg) */
const APART = { guard: 0.6, lunge: 2 }
/** the sword hand en garde, from its shoulder: the elbow bent, the hand ahead below the chest (of his arm) */
const READY = new Vector3(0.15, -0.45, 0.6)
/** the back hand en garde, raised behind him, and flung back straight as he lunges, from its shoulder (of his arm) */
const RAISED = new Vector3(0.3, 0.3, -0.3)
const FLUNG = new Vector3(0.2, -0.5, -0.8)
/** the way the blade points en garde and at the touch: ahead, up and in from the hand low on his right */
const BLADE = new Vector3(0.1, 0.12, 1).normalize()
/** how long the point takes to the target, the front foot landing after it (s) */
const REACH = 0.5

/** where on the ground a foot steps for his feet to stand so far apart along the piste, the other foot where it is */
function apart(body: Body, side: Side, of: number) {
  const other = body.foot[side === 'right' ? 'left' : 'right'].value
  return body.ground(side, { x: body.hips.value.x, z: other.z + (side === 'right' ? of : -of) * body.size.leg })
}

/** en garde: the foil ahead of him, its point toward the target, and the back hand raised */
function arms(body: Body, foil: Thing) {
  const { arm } = body.size
  void foil.to(READY.clone().multiplyScalar(arm), { on: body, pointing: BLADE })
  body.hand.left.to(RAISED.clone().multiplyScalar(arm), { on: body })
}

/** A right-handed fencer, the `foil` bound to him and led by his right hand, comes en garde: the front foot steps out. */
export function* guard(body: Body, foil: Thing): Story {
  const step = body.foot.right.to(apart(body, 'right', APART.guard))
  arms(body, foil)
  yield* step
}

/**
 * From en garde he lunges: the front foot goes far out, the back arm is flung back, and the point goes to the middle of
 * the `target` and stays there as he comes down onto the front foot; then the front foot comes back and he is en garde.
 * `recovering` is told as the recovery begins.
 */
export function* lunge(body: Body, foil: Thing, target: Pick<Target, 'at'>, recovering = () => {}): Story {
  // (far enough out for the hips, two thirds of the way onto the front foot and upright under the stretched arm, to have the point on the target: no further than a lunge goes)
  const hips = target.at.z - FOIL - body.size.arm - body.foot.left.value.z
  const out = body.foot.right.to(apart(body, 'right', Math.max(APART.guard, Math.min(APART.lunge, (1.5 * hips) / body.size.leg))), { seconds: REACH })
  body.hand.left.to(FLUNG.clone().multiplyScalar(body.size.arm), { on: body })
  yield* foil.to(touching(target, BLADE), { pointing: BLADE, seconds: REACH })
  yield* out
  recovering()
  yield* guard(body, foil)
}
