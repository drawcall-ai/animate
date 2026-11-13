import { Quaternion, Vector3 } from 'three'
import type { Ahead } from './ahead'
import { UP, behind, lowest, lunge, squat } from './hips'
import { RANGE } from './joints'
import { SLACK } from './limb'
import type { Reactions } from './react'
import { SOLE, type Side, tick } from './size'
import type { Stoop } from './stoop'
import type { Mover } from './stride'
import { clamp } from './world'

const hips = new Vector3()
const velocity = new Vector3()
const trunk = new Vector3()
const at = new Vector3()
const fore = new Vector3()
const off = new Vector3()
const turned = new Quaternion()

/** What a limb hangs on, a hip or a shoulder, and what the rest of the body does for the limb's end. */
type Hangs = {
  /** where it will be `seconds` from now, and how it will be turned */
  at(seconds: number, place: Vector3, turned: Quaternion): Vector3
  /**
   * Has the body get down toward a place by a `share` of the most it can, to be down at a moment and until another:
   * not if that would surely leave the limb more than `reach` from the place.
   */
  stoop(share: number, place: Vector3, when: number, until: number, reach: number): Stoop | undefined
}
/** a leg's hip: and the body steps with its foot, and stands on it */
export type Leg = Hangs & {
  leg: true
  /** whether the body can spare the foot from `seconds` from now `until` another moment, as far as it can tell */
  spare(seconds: number, until: number): boolean
  /** where the foot will be `seconds` from now, left to the body */
  stepped(seconds: number, at: Vector3): Vector3
  /** whether he is coming down out of the air: the foot is his again then, to land on */
  lands(): boolean
  /** the body is told from when until when the story has the foot, as it has sent it: it steps with it only otherwise */
  take(from: number | undefined, until: number): void
  /** has the body step with the foot to a place on the ground and stand over it there: or with none, keep it there no longer; and where it is to stand so, if it is */
  put(place?: Vector3): Vector3 | undefined
  placed(): Vector3 | undefined
}
/** an arm's shoulder: and the rest of the body winds up for its hand */
export type Arm = Hangs & {
  leg: false
  /**
   * the hand will set off at a moment to arrive fast at another, drawn back first: the rest of the body winds up and
   * swings into that, until it is off. Tells what of it that pushes, and how hard, in times its strength
   */
  wind(leaves: number, when: number, place: Vector3, velocity: Vector3): ReturnType<Reactions['wind']>
  unwind(): void
}
export type Root = Leg | Arm

/**
 * He gets down, the hips let down and the trunk bent, to be down at a moment and until another: which changes where
 * he is going. Not if a look that steps nothing ahead tells that what hangs `from` the hips and the trunk would
 * surely be more than `reach` from a place even so: with the hips no lower than he gets, lunging if he is going
 * along when they begin to sink, and standing low, as far back as they ride at the most.
 */
function stoop(
  mover: Mover,
  ahead: Ahead,
  [low, bend, when, until]: number[],
  from: (seconds: number, hips: Vector3, trunk: Vector3) => Vector3,
  place: Vector3,
  reach: number,
) {
  const { stoops } = mover
  // (he is down until the moment: how he is to be then is told a step before it)
  const [seconds, just] = [when - ahead.now, when - tick(mover.size)]
  const lower = Math.max(0, low - stoops.low(just))
  const stoop = stoops.add(low, bend, when, until, ahead.now)
  const lunges = ahead.look(Math.max(0, stoop.sinks - ahead.now)).copy.lunging
  ahead.hips(seconds, hips, velocity)
  hips.y = Math.min(hips.y, Math.max(hips.y - lower, (lunges ? lunge : lowest)(mover.size)))
  const root = from(seconds, hips, trunk.set(ahead.leans(just - ahead.now), 0, 0))
  // (back from the way he faces)
  fore.set(0, 0, 1).applyAxisAngle(UP, ahead.facing(seconds))
  if (!lunges) root.addScaledVector(fore, -clamp(off.subVectors(root, place).dot(fore), 0, behind(mover.size, hips.y)))
  if (root.distanceTo(place) > reach + SLACK.reach * mover.size.leg) {
    stoop.until = -Infinity
    return undefined
  }
  ahead.stale()
  return stoop
}

export function hip(side: Side, mover: Mover, ahead: Ahead): Leg {
  return {
    leg: true,
    at: (seconds, at, turned) => ahead.hip(side, seconds, at, turned),
    // for a foot the hips come down
    stoop: (share, place, when, until, reach) => {
      const from = (seconds: number, hips: Vector3) => ahead.hip(side, seconds, at, turned, hips)
      return stoop(mover, ahead, [share * squat(mover.size), 0, when, until], from, place, reach)
    },
    spare: (seconds, until) => ahead.spare(side, seconds, until),
    lands: () => mover.falls && mover.velocity.y <= 0,
    stepped: (seconds, at) => ahead.stepped(side, seconds, at),
    // (it sets off after the step of time it is told to at)
    take: (from, until) => {
      mover.foot[side].taken = from === undefined ? undefined : { from: from + tick(mover.size), until }
      ahead.stale()
    },
    put: (at) => {
      mover.put(side, at)
      ahead.stale()
      return mover.foot[side].put
    },
    placed: () => mover.foot[side].put,
  }
}

export function shoulder(side: Side, mover: Mover, ahead: Ahead, reactions: Reactions): Arm {
  const [back, forth] = RANGE.trunk.x
  return {
    leg: false,
    at: (seconds, at, turned) => ahead.shoulder(side, seconds, at, turned),
    // for a hand the trunk bends toward the place, forward, or back for what is behind his heels: and only once it
    // is bent as far as it goes do the hips come down, for what is below the shoulder and still out of reach
    stoop: (share, place, when, until, reach) => {
      const seconds = when - ahead.now
      const high = ahead.shoulder(side, seconds, at, turned).y
      fore.set(0, 0, 1).applyAxisAngle(UP, ahead.facing(seconds))
      const rear = off.subVectors(place, ahead.hips(seconds, hips, velocity)).dot(fore) < -SOLE.behind * mover.size.leg
      const low = place.y < high ? Math.max(0, 2 * share - 1) * squat(mover.size) : 0
      const from = (on: number, hips: Vector3, trunk: Vector3) => ahead.shoulder(side, on, at, turned, hips, trunk)
      return stoop(mover, ahead, [low, Math.min(1, 2 * share) * (rear ? back : forth), when, until], from, place, reach)
    },
    wind: (leaves, when, at, velocity) => reactions.wind(side, leaves, when, at, velocity),
    unwind: () => reactions.unwind(side),
  }
}
