import { Vector3 } from 'three'
import type { End } from './end'
import { type Footing } from './pelvis'
import { RANGE } from './joints'
import { type Limb, SLACK } from './limb'
import type { Way } from './way'
import { HEEL, SOLE, type Side, type Size, raised } from './size'
import { clamp, UP } from './world'

/** how fast a heel comes down again, and comes up (rad a beat) */
const ROLL = { down: 1.8, up: 9 }
/** how finely a heel is brought up to where its leg reaches, at first and in the end (rad) */
const RAISE = { step: 0.01, exact: 1e-4 }
/** how many times a beat an ankle eases to where it is to be, from where it was as its foot came down or left the ground */
const EASE = 6
/** how many times a beat a foot in the air comes round to how it hangs */
const DROOP = 9
const from = new Vector3()
const ankle = new Vector3()
const hip = new Vector3()
const holds = new Vector3()

/** how far a foot turns at the most with its ankle this high above where it stands, before the end of its sole so far along from the ankle is on the ground (rad) */
function tipped(ankle: number, high: number, sole: number) {
  const up = (high + ankle) / Math.hypot(sole, ankle)
  return up < 1 ? Math.asin(up) - Math.atan2(ankle, sole) : Infinity
}

/**
 * Where the ankle of a foot on the ground is: where the ground holds it, or up and on from there, the heel
 * coming up as far as the leg needs to reach it from a hip that has gone on ahead, and as far as keeps the shin
 * from leaning further over the foot than an ankle bends and the thigh from going further back than a hip lets it:
 * no less and no more than a `least` and a `most`. Tells how far up the heel is (rad).
 */
export function stood(size: Size, leg: Limb, anchor: Vector3, hip: Vector3, least: number, most: number, to: Vector3) {
  const short = () => hip.distanceTo(to) > leg.length
  const fits = (angle: number) => {
    const { y, z } = raised(size, Math.max(0, angle))
    to.set(anchor.x, anchor.y + y, anchor.z + z)
    if (short()) return false
    const { first, fold } = leg.reach(from.copy(to).sub(hip))
    return first.x <= RANGE.thigh.x[1] && first.x + fold - angle <= RANGE.ankle.x[1]
  }
  // as little up as fits, and that told exactly, a leg at its stretch folding far for a little: behind him, or under a hip too high for the leg, where that brings it nearer the hip
  let angle = least
  while (angle < HEEL && !fits(angle) && (anchor.z < hip.z || short())) angle += RAISE.step
  for (let step = RAISE.step / 2; angle > least && step > RAISE.exact; step /= 2) if (fits(angle - step)) angle -= step
  const heel = Math.min(most, angle)
  fits(heel)
  return heel
}

/** How a leg stands on its foot, or hangs from its hip: its heel, how its foot lies, and how its joints turn for its ankle to be where the foot is. */
export class Stance {
  /** how far its heel is up off the ground, and its foot turned toe down (rad) */
  private heel = 0
  private pitch = 0
  /** how far from where it is to be its ankle still is, since its foot last came down or left the ground */
  private readonly eased = new Vector3()
  private posed: 'stood' | 'sent' | 'stepped' = 'stood'

  /** a leg, and the foot at its end as the story has it and as the ground has it */
  constructor(
    private readonly size: Size,
    private readonly side: Side,
    private readonly leg: Limb,
    private readonly end: End,
    private readonly footing: Footing,
  ) {}

  /**
   * the leg reaches from its hip, where the hips, the pelvis turned and listing as it is, have it, for where its foot
   * is: on the ground, or the body's own in a step. It faces as its foot points, and all of it is told as it faces.
   * Tells whether its foot is where the story put it and the hips have gone further from it than its leg reaches
   */
  pose(hips: Way, delta: number) {
    const { size, leg, end, footing, side } = this
    const round = -hips.heading - footing.toes
    hips.hip(side, hip).applyAxisAngle(UP, round)
    const anchor = end.anchor && holds.copy(end.anchor).applyAxisAngle(UP, round)
    // (it comes down as it hung in the air)
    if (!anchor) this.heel = this.pitch
    const posed = anchor ? 'stood' : end.held ? 'sent' : 'stepped'
    const was = this.posed
    this.posed = posed
    // a foot the story has in the air its joints turn as it has sent them
    if (posed === 'sent') return
    // the heel comes down no faster than a foot rolls, and up no faster, from where it was
    const [down, up] = [(ROLL.down * delta) / size.beat, (ROLL.up * delta) / size.beat]
    const [least, most] = [this.heel - clamp(this.heel, -down, down), Math.min(HEEL, this.heel + up)]
    if (anchor) this.heel = stood(size, leg, anchor, hip, least, most, ankle)
    else hips.scene(footing.at, side, ankle).applyAxisAngle(UP, round)
    // coming down, or leaving the ground heel up, it goes on from where its ankle was, and eases to where it is to be
    if (posed !== was) this.eased.copy(end.value).applyAxisAngle(UP, round).sub(ankle)
    ankle.add(this.eased.multiplyScalar(Math.exp((-EASE * delta) / size.beat)))
    from.copy(ankle).sub(hip)
    const lost = anchor && footing.put && from.length() > leg.length + SLACK.reach * size.leg
    const { first, fold } = leg.reach(from)
    // (let go by the story, a leg swings out and comes round in time for its foot to come down)
    const within = footing.down ? 0 : footing.step?.remains
    leg.first.follow(first, delta, within)
    leg.second.follow(from.set(fold, 0, 0), delta, within)
    return lost
  }

  /**
   * How the foot is turned against its shin (rad), the leg turned so: it lies on the ground, flat or on its ball. Off
   * it in a stride it hangs square to its shin, and where he `falls` toe down for the ground: no further than the
   * ground under it lets its toe or its heel, and as far as an ankle bends.
   */
  foot(thigh: number, shin: number, falls: boolean, delta: number) {
    const { ankle, leg, beat } = this.size
    const high = Math.max(0, this.end.value.y - ankle)
    const [toe, heel] = [tipped(ankle, high, SOLE.ball * leg), tipped(ankle, high, SOLE.behind * leg)]
    const hangs =
      this.pitch + ((falls ? Math.min(HEEL, toe) : thigh + shin) - this.pitch) * Math.min(1, (DROOP * delta) / beat)
    this.pitch = this.end.anchor ? this.heel : clamp(hangs, -heel, toe)
    const [least, most] = RANGE.ankle.x
    return clamp(this.pitch - thigh - shin, -most, -least)
  }
}
