import { between, cubic, hardest as push, type Xyz } from '@drawcall/plan'
import { Vector3 } from 'three'

/** how far a value goes, along or about any of x, y and z: from the least to the most */
export type Range = Partial<Record<'x' | 'y' | 'z', [number, number]>>
export type State = { value: Xyz; velocity: Xyz }

export const AXES = ['x', 'y', 'z'] as const
/** how far past an end of its range a value still counts as within it */
const PAST = 0.02
/** how many places along a way are looked at to tell whether it keeps within a range */
const LOOKS = 8
/** how a time is looked for: from the shortest tried and each try so many times longer, up to the longest (s) */
const TIMES = { shortest: 0.01, longer: 1.1, longest: 10 }
const tried = new Vector3()
const triedVelocity = new Vector3()

/** how hard a part is pushed at the most on that curve, at its start or at its end: in times its `strength` */
export const hardest = (from: State, to: State, seconds: number, strength: number) => push(from, to, seconds) / strength

/** how far a value goes along or about an axis: what is so far `past` an end of its range still is within it */
export function bounds(range: Range, axis: (typeof AXES)[number], past = PAST) {
  const [least, most] = range[axis] ?? [-Infinity, Infinity]
  return [least - past, most + past]
}

/** how far a value is beyond a range, across its axes: none, inside it */
export const beyond = (value: Xyz, range: Range, past = PAST) =>
  AXES.reduce((sum, axis) => {
    const [least, most] = bounds(range, axis, past)
    return sum + Math.max(0, least - value[axis], value[axis] - most)
  }, 0)

/** a value brought as near as it is within a range, axis by axis */
export function within<T extends Xyz>(value: T, range: Range) {
  for (const axis of AXES) {
    const [least, most] = range[axis] ?? [-Infinity, Infinity]
    value[axis] = Math.min(most, Math.max(least, value[axis]))
  }
  return value
}

/**
 * Whether that curve keeps within a range. The more time it takes, the further it draws back first. One that starts
 * or ends outside the range has none to keep to.
 */
export function keeps(from: State, to: State, seconds: number, range: Range) {
  if (beyond(from.value, range) > 0 || beyond(to.value, range) > 0) return true
  for (let k = 1; k < LOOKS; k++) {
    if (beyond(cubic(k / LOOKS, seconds, from, to, tried, triedVelocity), range) > 0) return false
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
