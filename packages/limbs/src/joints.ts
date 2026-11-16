import { Vector3 } from 'three'
import type { Bones } from './bones'
import type { Range } from './curve'
import { Goal, REST } from './goal'
import { FINGERS, Fingers } from './fingers'
import { Limb } from './limb'
import { HEEL, SIDES, SIGN, both } from './size'

/**
 * How strong each part that turns is: the most it can accelerate (rad a beat, a beat), and how many times a beat it
 * comes round to what the body wants of it, free: the parts of a leg never do, which follow their foot.
 */
const PARTS = {
  trunk: { strength: 5.4, rate: 0.75 },
  head: { strength: 18, rate: 1.2 },
  arm: { strength: 27, rate: 1.8 },
  forearm: { strength: 63, rate: 1.8 },
  wrist: { strength: 63, rate: 1.8 },
  thigh: { strength: 18, rate: 0 },
  shin: { strength: 90, rate: 0 },
}
/** how far back a thigh goes (rad) */
const TRAIL = 0.6
/** how far a shin leans over its foot before the heel comes up (rad) */
export const ANKLE = 0.45
/**
 * How far the joints turn (rad): the trunk leaning back and forward, and the back curving so, a thigh and an upper arm
 * forward and back, a knee and an elbow folding, a foot toe down and a shin over its foot; and a hand against its
 * forearm: bent to the side of the thumb and of the little finger, the forearm twisting either way, and folding back
 * and forward at the wrist.
 */
export const RANGE = {
  trunk: { x: [-0.6, 1.1], y: [-1.4, 1.4], z: [-0.5, 0.5] },
  // the back curves only so far: the trunk leans back and forward further than that at the hips
  back: { x: [-0.3, 0.3] },
  head: { x: [-0.8, 0.8], y: [-1.4, 1.4], z: [-0.5, 0.5] },
  thigh: { x: [-2, TRAIL] },
  shin: { x: [0, 2.5] },
  // an upper arm goes on over the top to behind the head, where a thrower cocks it: turned out sideways there, which shows from the side as this
  arm: { x: [-Math.PI - 1, 1], y: [-1.5, 1.5], z: [-3.2, 3.2] },
  // an elbow folds one way only
  forearm: { x: [-2.57, 0], y: [0, 0], z: [0, 0] },
  wrist: { x: [-0.35, 0.6], y: [-1.6, 1.6], z: [-1.3, 1.3] },
  ankle: { x: [-HEEL, ANKLE] },
} satisfies Record<string, Range>

/**
 * the joints of a body, at rest, as its bones are: the trunk and the head against what each hangs on, the two joints
 * of each leg and arm, and at the end of an arm its hand, with the fingers of one whose rig has them; an arm hangs
 * beside the trunk as it is shaped, as thick as the arm is
 */
export function joints(bones: Bones) {
  const { thigh, shin, upperArm, forearm, beat } = bones.size
  const { shape } = bones
  const part = (kind: keyof typeof PARTS, name: string = kind) => {
    const { strength, rate } = PARTS[kind]
    return new Goal(name, REST, strength / beat ** 2, RANGE[kind], rate / beat)
  }
  return {
    trunk: part('trunk'),
    head: part('head'),
    legs: both(
      (side) =>
        new Limb(part('thigh', `${side} thigh`), part('shin', `${side} shin`), thigh, shin, true, undefined, undefined),
    ),
    arms: both((side) => {
      const trunk = { side: SIGN[side], bands: bones.beside(side), upper: shape.upperArm, fore: shape.forearm }
      // hanging, a palm faces the trunk
      const palm = new Vector3(-SIGN[side], 0, 0)
      const chains = bones.chains(side)
      const fingers = chains && new Fingers(`${side} hand`, side, chains, beat, shape.finger)
      const hand = { wrist: part('wrist', `${side} wrist`), palm, fingers }
      const [arm, fore] = [part('arm', `${side} arm`), part('forearm', `${side} forearm`)]
      return new Limb(arm, fore, upperArm, forearm, false, trunk, hand)
    }),
  }
}
export type Joints = ReturnType<typeof joints>

/** every part of them that turns */
export const parts = ({ trunk, head, legs, arms }: Joints) => [
  trunk,
  head,
  ...SIDES.flatMap((side) => [arms[side].first, arms[side].second, legs[side].first, legs[side].second]),
  ...SIDES.flatMap((side) => {
    const { wrist, fingers } = arms[side].hand
    return [wrist, ...FINGERS.flatMap((finger) => (fingers ? [fingers.spread[finger], fingers.bend[finger]] : []))]
  }),
]
