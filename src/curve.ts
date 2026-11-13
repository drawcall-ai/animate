import { Vector3 } from 'three'
import type { Xyz } from './world'

/** how far a value goes, along or about any of x, y and z: from the least to the most */
export type Range = Partial<Record<'x' | 'y' | 'z', [number, number]>>
/** where something is and how it moves */
export type State = { value: Xyz; velocity: Xyz }

export const AXES = ['x', 'y', 'z'] as const
/** how far past an end of its range a value still counts as within it */
const PAST = 0.02
/** how many places along a way are looked at to tell whether it keeps within a range */
const LOOKS = 8
/** how a time is looked for: from the shortest tried and each try so many times longer, up to the longest (s), and then between two so many times over, halving */
const TIMES = { shortest: 0.01, longer: 1.1, longest: 10, halvings: 10 }
const gap = new Vector3()
const push = new Vector3()
const tried = new Vector3()
const triedVelocity = new Vector3()

/** where the one curve that leaves as it was going and arrives as asked with the least pushing is, a share `s` of the way through its `T` seconds */
export function cubic(s: number, T: number, from: State, to: State, value: Vector3, velocity: Vector3) {
  const [s2, s3] = [s * s, s * s * s]
  velocity
    .copy(from.value)
    .multiplyScalar((6 * s2 - 6 * s) / T)
    .addScaledVector(from.velocity, 3 * s2 - 4 * s + 1)
    .addScaledVector(to.value, (6 * s - 6 * s2) / T)
    .addScaledVector(to.velocity, 3 * s2 - 2 * s)
  return value
    .copy(from.value)
    .multiplyScalar(2 * s3 - 3 * s2 + 1)
    .addScaledVector(from.velocity, (s3 - 2 * s2 + s) * T)
    .addScaledVector(to.value, 3 * s2 - 2 * s3)
    .addScaledVector(to.velocity, (s3 - s2) * T)
}

/** how hard a part is pushed at the most on that curve, at its start or at its end: in times its `strength` */
export function hardest(from: State, to: State, seconds: number, strength: number) {
  gap.copy(to.value).sub(from.value)
  const times = (far: number, was: number, then: number) => {
    push.copy(gap).multiplyScalar(far / seconds)
    return push.addScaledVector(from.velocity, was).addScaledVector(to.velocity, then).length() / strength
  }
  return Math.max(times(6, -4, -2), times(-6, 2, 4)) / seconds
}

/** the longest time that `holds` and the shortest that does not, between one that does and one that does not: halving */
function between(short: number, long: number, holds: (seconds: number) => boolean) {
  for (let k = 0; k < TIMES.halvings; k++) {
    const middle = (short + long) / 2
    if (holds(middle)) short = middle
    else long = middle
  }
  return [short, long]
}

/** whether a value is within a range: what is at an end of it still is */
export const inside = (value: Xyz, range: Range) =>
  AXES.every((axis) => !range[axis] || (value[axis] >= range[axis][0] - PAST && value[axis] <= range[axis][1] + PAST))

/**
 * Whether that curve keeps within a range. The more time it takes, the further it draws back first. One that starts
 * or ends outside the range has none to keep to.
 */
export function keeps(from: State, to: State, seconds: number, range: Range) {
  if (!inside(from.value, range) || !inside(to.value, range)) return true
  for (let k = 1; k < LOOKS; k++) {
    if (!inside(cubic(k / LOOKS, seconds, from, to, tried, triedVelocity), range)) return false
  }
  return true
}

/**
 * How long a part takes at the least on that curve, pushed no harder than its `strength`: if it goes only within a
 * `range`, it takes no longer than keeps it there.
 */
export function quickest(from: State, to: State, strength: number, range: Range) {
  const hard = (seconds: number) => hardest(from, to, seconds, strength) > 1
  // a little more time can take more pushing, so the first time that takes little enough is looked for closely
  let [short, long] = [0, TIMES.shortest]
  while (hard(long) && keeps(from, to, long * TIMES.longer, range) && long < TIMES.longest) {
    ;[short, long] = [long, long * TIMES.longer]
  }
  return between(short, long, (seconds) => hard(seconds) && keeps(from, to, seconds, range))[1]
}

/** how long that curve can take at the most, and no longer than `most`, to keep within a range (s): so long, it draws back as far as the range goes before a fast arrival */
export function longest(from: State, to: State, most: number, range: Range) {
  if (keeps(from, to, most, range)) return most
  return between(0, most, (seconds) => keeps(from, to, seconds, range))[0]
}
