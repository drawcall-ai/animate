import type { Range } from './curve'
import { Goal, REST } from './goal'
import { Limb } from './limb'
import { HEEL, SIDES, SIGN, SIZE, both } from './size'
import type { Xyz } from './world'

/**
 * How strong each part that turns is: the most it can accelerate (rad/s²), and for those that react, how many times
 * a second they come round.
 */
export const PARTS = {
  trunk: { strength: 60, rate: 2.5 },
  head: { strength: 200, rate: 4 },
  arm: { strength: 300, rate: 6 },
  forearm: { strength: 700, rate: 6 },
  thigh: { strength: 200 },
  shin: { strength: 1000 },
}
/** how far back a thigh goes (rad) */
export const TRAIL = 0.6
/** how far a shin leans over its foot before the heel comes up (rad) */
export const ANKLE = 0.45
/**
 * How far the joints turn (rad): the trunk leaning back and forward, a thigh and an upper arm forward and back, a
 * knee and an elbow folding, a foot toe down and a shin over its foot.
 */
export const RANGE = {
  trunk: { x: [-0.6, 0.9], y: [-1.4, 1.4], z: [-0.5, 0.5] },
  head: { x: [-0.8, 0.8], y: [-1.4, 1.4], z: [-0.5, 0.5] },
  thigh: { x: [-2, TRAIL] },
  shin: { x: [0, 2.5] },
  // an upper arm goes on over the top to behind the head, where a thrower cocks it: turned out sideways there, which shows from the side as this
  arm: { x: [-Math.PI - 1, 1], y: [-1.5, 1.5], z: [-3.2, 3.2] },
  // an elbow folds one way only
  forearm: { x: [-2.5, 0], y: [0, 0], z: [0, 0] },
  ankle: { x: [-HEEL, ANKLE] },
} satisfies Record<string, Range>

/** a part that turns, as strong as it is and turning as far as it does */
export const part = (kind: keyof typeof PARTS, name: string = kind, value: Xyz = REST) =>
  new Goal(name, value, PARTS[kind].strength, RANGE[kind])

/** the joints of a body, at rest: the trunk and the head against what each hangs on, and the two joints of each leg and arm */
export const joints = () => ({
  trunk: part('trunk'),
  head: part('head'),
  legs: both(
    (side) => new Limb(part('thigh', `${side} thigh`), part('shin', `${side} shin`), SIZE.thigh, SIZE.shin, true),
  ),
  arms: both((side) => {
    const [arm, forearm] = [part('arm', `${side} arm`), part('forearm', `${side} forearm`)]
    return new Limb(arm, forearm, SIZE.upperArm, SIZE.forearm, false, SIGN[side] * SIZE.shoulder)
  }),
})
export type Joints = ReturnType<typeof joints>

/** every part of them that turns */
export const parts = ({ trunk, head, legs, arms }: Joints) => [
  trunk,
  head,
  ...SIDES.flatMap((side) => [arms[side].first, arms[side].second, legs[side].first, legs[side].second]),
]
