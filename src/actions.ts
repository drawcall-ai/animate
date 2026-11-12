import { type ActionUpdate, action } from '@pmndrs/timeline'
import { Euler, Quaternion, Vector3 } from 'three'
import { type Landing, smooth } from './gait'
import type { Humanoid } from './humanoid'
import { type Muscle, type Part, muscles } from './part'
import type { Side } from './skeleton'

/** holds a part at a rotation against its parent's, rest being identity, for as long as the action runs */
export function pose(part: Part, rotation: Quaternion | Euler, muscle: Muscle = muscles.firm): ActionUpdate<unknown> {
  const target = rotation instanceof Euler ? new Quaternion().setFromEuler(rotation) : rotation
  return () => part.ask(muscle, target)
}

/** lets a part go as its weight and speed take it */
export function relax(part: Part): ActionUpdate<unknown> {
  return () => part.ask(muscles.slack)
}

/** has the legs keep a speed forward (m/s); without it the humanoid comes to a stand in whatever steps that takes */
export function run(human: Humanoid, speed: number): ActionUpdate<unknown> {
  return () => {
    human.pace = speed
  }
}

/** turns the balance assist on or off */
export function balance(human: Humanoid, on: boolean): ActionUpdate<unknown> {
  return () => {
    human.balance = on
  }
}

const ankle = new Vector3()

/**
 * A contact the timeline names: that foot comes down `at` a place along z, how it `lands`, and how far its knee is
 * to `bend` under the weight (rad). Over when it has landed; returns false if it has not within `seconds`.
 */
export function* step(
  human: Humanoid,
  side: Side,
  { at, lands = 'firm', bend = 0, seconds = 2 }: { at: number; lands?: Landing; bend?: number; seconds?: number },
) {
  const leg = human.gait[side]
  leg.named = { at, lands, bend }
  // a foot already in the air goes on from where it is
  const through = leg.swing ? smooth(leg.swing.s) : 1
  if (leg.swing && through < 1) leg.swing.from = (human.parts[`${side}Foot`].socket(ankle).z - at * through) / (1 - through)
  yield* action({ until: (_state, _clock, time) => leg.named === null || time >= seconds })
  if (leg.named === null) return true
  leg.named = null
  return false
}
