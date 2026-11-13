import { Vector3 } from 'three'

/** a fencing target: the middle of its padded face, which looks back along z, whether the point is on it, and how many touches have landed */
export type Target = { at: Vector3; on: boolean; touches: number }

/** how wide the pad is across and how thick, and how high its middle is (m) */
export const PAD = { radius: 0.2, thick: 0.08, middle: 1.15 }
/** how long the foil is from the hand to its point (m) */
export const FOIL = 0.9
/** how near the pad's face the point counts as on it (m) */
const TOUCH = 0.03

/** a target whose face is `ahead` of the origin (m) */
export const targetAt = (ahead: number): Target => ({ at: new Vector3(0, PAD.middle, ahead), on: false, touches: 0 })

/** where the point of the foil is, held in a hand: it is pointed at the middle of the target */
export const point = (target: Target, hand: Vector3) =>
  target.at.clone().sub(hand).normalize().multiplyScalar(FOIL).add(hand)

/** where a hand is as the point of its foil meets the middle of the target, the blade level */
export const touching = (target: Target) => new Vector3(target.at.x, target.at.y, target.at.z - FOIL)

/** the foil is in a hand that is somewhere: a touch is counted as its point comes onto the pad */
export function fence(target: Target, hand: Vector3) {
  const on = hand.distanceTo(target.at) <= FOIL + TOUCH
  if (on && !target.on) target.touches++
  target.on = on
}
