import { Vector3 } from 'three'
import { runs, SPEEDS, span, wide } from './gait'
import { clamp, GRAVITY, type Side, SIGN, type Size, UP, wrap } from '@drawcall/limbs'
import { twist } from './way'

/** the hips as the steps need them: where in the scene, going how fast along the way they go and turning so (m, m/s, rad, rad/s), and facing so and turning so */
export type Going = {
  at: Vector3
  speed: number
  /** how fast he is speeding up along it (m/s²) */
  faster: number
  heading: number
  curves: number
  facing: number
  spins: number
  /** how far round from where he faces he is yet to come (rad) */
  aims: number
}

/** how far round past where he turns to a foot comes down, for him to come on round over it (rad) */
const LEAD = 0.5
/** how far into a turn he leans at the most, as the tangent of the angle: his feet out from under his hips */
const LEAN = 0.35
/** how much further from under its hip than a straight leg reaches from as low as the hips ride a foot comes down at the most, its heel first (in lengths of his leg) */
const REACH = 0.03
/** how far apart across him his feet are at the least, in shares of how far out from his middle each stands */
const APART = 1.5

export const flat = (angle: number, to = new Vector3()) => to.set(Math.sin(angle), 0, Math.cos(angle))
/** the way to his left along the ground, facing so */
export const left = (angle: number, to = new Vector3()) => to.set(Math.cos(angle), 0, -Math.sin(angle))

/** where the hips will be in so long, going on as they go, speeding up or slowing as they do, and turning as they turn */
export function ahead(size: Size, going: Going, seconds: number, to = new Vector3()) {
  const { at, heading, curves } = going
  // (as fast on average as speeding up that dies away has him, and not round to going back)
  const lasts = SPEEDS * size.beat
  const mean = going.speed + going.faster * lasts * (1 - (lasts / seconds) * (1 - Math.exp(-seconds / lasts)))
  const speed = mean * going.speed < 0 ? 0 : mean
  if (Math.abs(curves * seconds) < 1e-4) return flat(heading, to).multiplyScalar(speed * seconds).add(at)
  const [turned, r] = [heading + curves * seconds, speed / curves]
  return to.set(r * (Math.cos(heading) - Math.cos(turned)), 0, r * (Math.sin(turned) - Math.sin(heading))).add(at)
}

/**
 * which way he will face in so long: on round as he turns, no further than he is to, and by default a lead further
 * round, for a foot that comes down so to let him come on round over it
 */
export function faces({ facing, spins, aims }: Going, seconds: number, lead = LEAD) {
  return facing + Math.sign(aims) * Math.min(Math.abs(aims), Math.abs(spins) * seconds + lead)
}

/** how far through its time on the ground a foot is under the hips: it comes down nearer ahead of them than it leaves behind */
export function over(size: Size, speed: number) {
  const reaches = span(size, speed)
  return reaches.ahead / (reaches.ahead + reaches.behind)
}

/** a foot is kept to its own side of the other, as he faces so, so far from it across him: or so much of the way there */
export function clear(size: Size, foot: Vector3, side: Side, other: Vector3, faced: number, speed: number, share = 1) {
  const across = left(faced)
  const gap = SIGN[side] * foot.clone().sub(other).dot(across)
  const least = APART * wide(size, speed)
  if (gap < least) foot.addScaledVector(across, SIGN[side] * (least - gap) * share)
}

/**
 * where a place on the ground is as the way he goes will have turned so much further: turned with it about where it
 * turns round, so that a footfall that came down before is to the side of his way as it was then
 */
function onward(going: Going, place: Vector3, turned: number) {
  const { at, heading, curves, speed } = going
  if (Math.abs(turned) < 1e-6) return place.clone()
  const centre = left(heading).multiplyScalar(speed / curves).add(at)
  return place.clone().sub(centre).applyAxisAngle(UP, turned).add(centre)
}

/**
 * Where a foot comes down that does so in so long and stays on the ground for so long after, the other foot's footfall
 * where it is: where the hips will be at the middle of its time on the ground, out to its side as he will face then,
 * and a little out of a turn, for him to lean into it; never across the other footfall, as it lies from his way, and
 * where its leg reaches as it comes down. Tells that place in the scene and which way the foot points there.
 */
export function footfall(size: Size, going: Going, side: Side, lands: number, stays: number, other: Vector3) {
  const middle = lands + stays * over(size, going.speed)
  const to = ahead(size, going, middle)
  // (turning, it points no further from how his hips face as it comes down than its leg turns)
  const hips = faces(going, lands, 0)
  const [least, most] = twist(side)
  const toes = hips + clamp(wrap(faces(going, middle) - hips), least, most)
  const out = left(toes).multiplyScalar(SIGN[side] * wide(size, going.speed))
  to.add(out)
  const pulled = (going.speed * going.curves) / GRAVITY
  to.addScaledVector(left(going.heading + going.curves * middle), -clamp(pulled, -LEAN, LEAN) * size.stand)
  // (at a run the two are on the ground one after the other, half a stride apart, as his way turns between them)
  const apart = (runs(size, going.speed) * going.curves * (lands + stays)) / 2
  clear(size, to, side, onward(going, other, apart), hips, going.speed)
  const under = ahead(size, going, lands).add(out)
  const off = to.clone().sub(under).setY(0)
  const reach = span(size, going.speed).ahead + REACH * size.leg
  if (off.length() > reach) to.copy(under).add(off.setLength(reach))
  to.y = size.ankle
  return { to, toes }
}
