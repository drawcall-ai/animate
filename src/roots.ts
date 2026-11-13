import { Quaternion, Vector3 } from 'three'
import type { Ahead } from './ahead'
import { LOW, LUNGE, SQUAT, behind } from './hips'
import { RANGE } from './joints'
import { SLACK } from './limb'
import type { Reactions } from './react'
import { SOLE, type Side } from './size'
import type { Stoop } from './stoop'
import type { Mover } from './stride'
import { TICK, clamp } from './world'

const hips = new Vector3()
const velocity = new Vector3()
const trunk = new Vector3()
const at = new Vector3()
const turned = new Quaternion()

/** What a limb hangs on, a hip or a shoulder, and what the rest of the body does for the limb's end. */
export type Root = {
  /** where it will be `seconds` from now, and how it will be turned */
  at(seconds: number, place: Vector3, turned: Quaternion): Vector3
  /** how far the hips and the feet go, and the trunk turns, from a moment to another, `seconds` from now (m, rad): any way at all, before now */
  goes(from: number, to: number): number
  /**
   * Has the body get down toward a place by a `share` of the most it can, to be down at a moment and until another:
   * not if that would surely leave the limb more than `reach` from the place.
   */
  stoop(share: number, place: Vector3, when: number, until: number, reach: number): Stoop | undefined
  /** has the body stay down for that only until a moment */
  rise(stoop: Stoop, at: number): void
  /** whether the body can spare the end from `seconds` from now `until` another moment, as far as it can tell: a foot it would stand on */
  spare?(seconds: number, until: number): boolean
  /** where the end will be `seconds` from now, left to the body: a foot it steps with */
  stepped?(seconds: number, at: Vector3): Vector3
  /** the body is told from when until when the story has the end, as it has sent it: a foot it steps with only otherwise */
  take?(from: number | undefined, until: number): void
  /** has the body step with the end to a place on the ground and stand over it there: or with none, keep it there no longer */
  put?(place?: Vector3): void
  /** the body is told that the end will set off at a moment to arrive fast at another, drawn back first, for the rest of it to wind up and swing into that, until that is off: and tells what of it that pushes, and how hard, in times its strength */
  wind?(leaves: number, when: number, place: Vector3, velocity: Vector3): ReturnType<Reactions['wind']>
  unwind?(): void
}

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
  const [seconds, just] = [when - ahead.now, when - TICK]
  const lower = Math.max(0, low - stoops.low(just))
  const stoop = stoops.add(low, bend, when, until, ahead.now)
  const lunges = ahead.look(Math.max(0, stoop.sinks - ahead.now)).tick.lunging
  ahead.hips(seconds, hips, velocity)
  hips.y = Math.min(hips.y, Math.max(hips.y - lower, lunges ? LUNGE : LOW))
  const root = from(seconds, hips, trunk.set(ahead.leans(just - ahead.now), 0, 0))
  if (!lunges) root.z -= clamp(root.z - place.z, 0, behind(hips.y))
  if (root.distanceTo(place) > reach + SLACK.reach) {
    stoop.until = -Infinity
    return undefined
  }
  ahead.stale()
  return stoop
}

const rise = (ahead: Ahead) => (stoop: Stoop, at: number) => {
  stoop.until = at
  ahead.stale()
}

/** what a leg hangs on: its hip */
export function hip(side: Side, mover: Mover, ahead: Ahead): Root {
  return {
    at: (seconds, at, turned) => ahead.hip(side, seconds, at, turned),
    goes: (from, to) => ahead.goes(from, to),
    // for a foot the hips come down
    stoop: (share, place, when, until, reach) => {
      const from = (seconds: number, hips: Vector3) => ahead.hip(side, seconds, at, turned, hips)
      return stoop(mover, ahead, [share * SQUAT, 0, when, until], from, place, reach)
    },
    rise: rise(ahead),
    spare: (seconds, until) => ahead.spare(side, seconds, until),
    stepped: (seconds, at) => ahead.stepped(side, seconds, at),
    // (it sets off after the step of time it is told to at)
    take: (from, until) => {
      mover.foot[side].taken = from === undefined ? undefined : { from: from + TICK, until }
      ahead.stale()
    },
    put: (at) => {
      mover.put(side, at)
      ahead.stale()
    },
  }
}

/** what an arm hangs on: its shoulder */
export function shoulder(side: Side, mover: Mover, ahead: Ahead, reactions: Reactions): Root {
  const [back, forth] = RANGE.trunk.x
  return {
    at: (seconds, at, turned) => ahead.shoulder(side, seconds, at, turned),
    goes: (from, to) => ahead.goes(from, to),
    // for a hand the trunk bends toward the place, forward, or back for what is behind his heels: and only once it
    // is bent as far as it goes do the hips come down, for what is below the shoulder and still out of reach
    stoop: (share, place, when, until, reach) => {
      const seconds = when - ahead.now
      const high = ahead.shoulder(side, seconds, at, turned).y
      const rear = place.z < ahead.hips(seconds, hips, velocity).z - SOLE.behind
      const low = place.y < high ? Math.max(0, 2 * share - 1) * SQUAT : 0
      const from = (on: number, hips: Vector3, trunk: Vector3) => ahead.shoulder(side, on, at, turned, hips, trunk)
      return stoop(mover, ahead, [low, Math.min(1, 2 * share) * (rear ? back : forth), when, until], from, place, reach)
    },
    rise: rise(ahead),
    wind: (leaves, when, at, velocity) => reactions.wind(side, leaves, when, at, velocity),
    unwind: () => reactions.unwind(side),
  }
}
