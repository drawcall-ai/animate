import { Vector3 } from 'three'
import { ahead, clamp, left, leant, over, runs, type Side, SIGN, type Size, SOLE, span, twist, UP, wide, wrap } from './measure'

/**
 * the hips as the strides need them: where on the ground, how fast along the way he goes (m/s, back on it below 0),
 * speeding up so (m/s²), the way he goes and how fast it turns (rad, rad/s), how he faces and turns, and how far round
 * he is yet to come (rad)
 */
export type Going = { at: Vector3; speed: number; faster: number; heading: number; curves: number; facing: number; spins: number; aims: number }

/**
 * how many steps a beat he takes: at the least, at the most, and going, so many and so many more for the root of
 * every pace; how far round a step turns him (rad), in how many beats he steps round to face as he is to; and how
 * many times as fast again he steps sideways and backwards, a leg swinging less far that way
 */
const RATE = { least: 0.54, most: 1.35, going: 0.18, faster: 0.54, turns: 1.1, ahead: 2, aside: 4, back: 0.6 }
/** how far ahead he steps for how fast he is speeding up (in beats) */
const SOON = 0.7
/** how much of a stride a foot is down at the least running, walking, and at the most */
const DUTY = { least: 0.2, walk: 0.55, most: 0.65 }
/** how far round past where he turns to a foot comes down, for him to come on round over it (rad) */
const LEAD = 0.5
/** how much further than a straight leg reaches a foot comes down at the most (in legs), and how far apart across him feet are at the least (in shares of how far out each stands) */
const REACH = 0.03
const APART = 1.5
/** sidestepping, past how far off the way he goes he faces (the sine), and below how fast (in paces); the foot ahead steps out so far, and so much further for every pace (in legs) */
const SIDLE = { across: 0.7, most: 0.5, step: 0.4, faster: 0.6 }

/** how many times as fast as he goes he steps, as if he went: sideways and backwards */
const short = ({ facing, heading, speed }: Going) => 1 + RATE.aside * Math.abs(Math.sin(facing - heading)) + (speed < 0 ? RATE.back : 0)

/** how fast he will be going by the time a foot set down now has gone by (m/s) */
const soon = (size: Size, { speed, faster }: Going) => {
  const then = speed + faster * SOON * size.beat
  return then * speed < 0 ? 0 : then
}

/** how many strides a second he takes, going as he goes and turning as he turns: two steps to a stride */
export function rate(size: Size, going: Going) {
  const { beat, pace } = size
  const fast = (short(going) * Math.abs(soon(size, going))) / pace
  const turns = Math.max(Math.abs(going.spins), Math.abs(going.aims) / (RATE.ahead * beat))
  const steps = Math.max(RATE.going + RATE.faster * Math.sqrt(fast), (turns * beat) / RATE.turns)
  return clamp(steps, RATE.least, RATE.most) / beat / 2
}

/** how much of a stride of so long a foot is down: as long as the hips take to go past where its leg reaches, and walking, never all in the air */
export function duty(size: Size, going: Going, stride: number) {
  const { ahead, behind } = span(size, going.speed)
  const gone = short(going) * Math.abs(soon(size, going)) * stride
  const least = DUTY.walk + (DUTY.least - DUTY.walk) * runs(size, going.speed)
  return clamp((ahead + behind) / gone, least, DUTY.most)
}

/** which way he will face in so long: on round as he turns, no further than he is to, and a lead further, for a foot to let him come round over it */
export const faces = ({ facing, spins, aims }: Going, seconds: number, lead = LEAD) =>
  facing + Math.sign(aims) * Math.min(Math.abs(aims), Math.abs(spins) * seconds + lead)

/** a foot is kept to its own side of the other, as he faces so, and so much further (m): or so much of the way there */
export function clear(size: Size, foot: Vector3, side: Side, partner: Vector3, faced: number, speed: number, share = 1, more = 0) {
  const across = left(faced)
  const gap = SIGN[side] * foot.clone().sub(partner).dot(across)
  const least = APART * wide(size, speed) + more
  if (gap < least) foot.addScaledVector(across, SIGN[side] * (least - gap) * share)
}

/** where a place on the ground will be as the way he goes turns so much further, turned with it about where it turns round */
function onward({ at, heading, curves, speed }: Going, place: Vector3, turned: number) {
  if (Math.abs(turned) < 1e-6) return place.clone()
  const centre = left(heading).multiplyScalar(speed / curves).add(at)
  return place.clone().sub(centre).applyAxisAngle(UP, turned).add(centre)
}

/**
 * Where a foot comes down that does so in `lands` s and stays down `stays` s, the other's footfall where it is: where
 * the hips are planned to be at the middle of its time down, out to its side as he will face, a little out of a turn
 * for him to lean into it, never across the other footfall, and where its leg reaches as it comes down. Tells the place
 * and which way the foot points there.
 */
export function footfall(size: Size, going: Going, side: Side, lands: number, stays: number, partner: Vector3, hips: (seconds: number) => Vector3) {
  const middle = lands + stays * over(size, going.speed)
  const to = hips(middle)
  // (turning, it points no further from how his hips face as it comes down than its leg turns)
  const faced = faces(going, lands, 0)
  const [least, most] = twist(side)
  const toes = faced + clamp(wrap(faces(going, middle) - faced), least, most)
  const out = left(toes).multiplyScalar(SIGN[side] * wide(size, going.speed))
  to.add(out).addScaledVector(left(going.heading + going.curves * middle), -leant(going.speed, going.curves) * size.stand)
  // (sidestepping, the foot whose hip is ahead steps out half a step, and the other closes up to it, no nearer than his hips are wide)
  const way = ahead(going.heading).multiplyScalar(Math.sign(going.speed) || 1)
  if (Math.abs(Math.sin(going.facing - going.heading)) > SIDLE.across && Math.abs(going.speed) < SIDLE.most * size.pace) {
    const leads = SIGN[side] * left(going.facing).dot(way) > 0
    if (leads) to.addScaledVector(way, ((SIDLE.step + (SIDLE.faster * Math.abs(going.speed)) / size.pace) * size.leg) / 2)
    else to.addScaledVector(way, Math.min(0, partner.clone().sub(to).dot(way) - 2 * size.hip))
  }
  // (no further than its leg reaches as it comes down)
  const under = hips(lands).add(out)
  const off = to.clone().sub(under).setY(0)
  const reach = span(size, going.speed).ahead + REACH * size.leg
  if (off.length() > reach) to.copy(under).add(off.setLength(reach))
  // never across the other footfall: at a run the two are down one after the other, half a stride apart, as his way
  // turns between them; and its ball clear of the other's, as it points
  const apart = (runs(size, going.speed) * going.curves * (lands + stays)) / 2
  clear(size, to, side, onward(going, partner, apart), faced, going.speed)
  const ball = (turned: number) => ahead(turned).multiplyScalar(SOLE.ball * size.leg)
  to.add(ball(toes))
  clear(size, to, side, partner.clone().add(ball(faced)), faced, going.speed)
  to.sub(ball(toes))
  return { to, toes }
}
