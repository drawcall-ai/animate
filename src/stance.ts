import { Vector3 } from 'three'
import type { End } from './end'
import { type Footing, socket } from './hips'
import { RANGE } from './joints'
import { type Limb, SLACK } from './limb'
import { HEEL, LEG, SIZE, SOLE, type Side, raised } from './size'
import { TICK, clamp } from './world'

/** how fast a heel comes down again, and comes up (rad/s) */
const ROLL = { down: 6, up: 30 }
/** how finely a heel is brought up to where its leg reaches, at first and in the end (rad) */
const [FINE, EXACT] = [0.01, 1e-4]
/** how many times a second an ankle eases to where it is to be, from where it was as its foot came down or left the ground */
const EASE = 20
/** how many times a second a foot in the air comes round to how it hangs */
const DROOP = 30
const hip = new Vector3()
const from = new Vector3()
const ankle = new Vector3()
const aside = new Vector3()

/** how far a foot turns at the most with its ankle this high above where it stands, before the end of its sole so far along from the ankle is on the ground (rad) */
function tipped(high: number, sole: number) {
  const up = (high + SIZE.ankle) / Math.hypot(sole, SIZE.ankle)
  return up < 1 ? Math.asin(up) - Math.atan2(SIZE.ankle, sole) : Infinity
}

/**
 * Where the ankle of a foot on the ground is: where the ground holds it, or up and on from there, the heel
 * coming up as far as the leg needs to reach it from a hip that has gone on ahead, and as far as keeps the shin
 * from leaning further over the foot than an ankle bends and the thigh from going further back than a hip lets it:
 * no less and no more than a `least` and a `most`. Tells how far up the heel is (rad). The hip is `aside` of the hips.
 */
export function stood(
  leg: Limb,
  anchor: Vector3,
  hips: Vector3,
  aside: Vector3,
  least: number,
  most: number,
  to: Vector3,
) {
  hip.copy(hips).add(aside)
  const short = () => hip.distanceTo(to) > LEG
  const fits = (angle: number) => {
    const { y, z } = raised(Math.max(0, angle))
    to.set(anchor.x, anchor.y + y, anchor.z + z)
    if (short()) return false
    const { first, fold } = leg.reach(from.copy(to).sub(hip))
    return first.x <= RANGE.thigh.x[1] && first.x + fold - angle <= RANGE.ankle.x[1]
  }
  // as little up as fits, and that told exactly, a leg at its stretch folding far for a little: behind him, or under a hip too high for the leg, where that brings it nearer the hip
  let angle = least
  while (angle < HEEL && !fits(angle) && (anchor.z < hip.z || short())) angle += FINE
  for (let step = FINE / 2; angle > least && step > EXACT; step /= 2) if (fits(angle - step)) angle -= step
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
  /** how it was last posed: standing on the ground, sent by the story, or stepped by the body */
  private posed: 'stood' | 'sent' | 'stepped' = 'stood'

  /** a leg, and the foot at its end as the story has it and as the ground has it */
  constructor(
    private readonly side: Side,
    private readonly leg: Limb,
    private readonly end: End,
    private readonly footing: Footing,
  ) {}

  /** the leg reaches from its hip, where the hips, the pelvis turned and listing as it is, have it, for where its foot is: on the ground, or the body's own in a step */
  pose({ value: hips, turn, list }: { value: Vector3; turn: number; list: number }, delta: number) {
    const { leg, end, footing } = this
    socket(this.side, turn, list, aside)
    const { anchor } = end
    // (it comes down as it hung in the air)
    if (!anchor) this.heel = this.pitch
    const posed = anchor ? 'stood' : end.held ? 'sent' : 'stepped'
    const was = this.posed
    this.posed = posed
    // a foot the story has in the air its joints turn as it has sent them
    if (posed === 'sent') return
    // the heel comes down no faster than a foot rolls, and up no faster, from where it was
    const down = ROLL.down * TICK
    const [least, most] = [this.heel - clamp(this.heel, -down, down), Math.min(HEEL, this.heel + ROLL.up * TICK)]
    if (anchor) this.heel = stood(leg, anchor, hips, aside, least, most, ankle)
    else ankle.copy(footing.at)
    // coming down, or leaving the ground heel up, it goes on from where its ankle was, and eases to where it is to be
    if (posed !== was) this.eased.copy(end.value).sub(ankle)
    ankle.add(this.eased.multiplyScalar(Math.exp(-EASE * delta)))
    from.copy(ankle).sub(hips).sub(aside)
    if (anchor && footing.put && from.length() > LEG + SLACK.reach) {
      throw new Error(
        `the ${this.side} foot is to stay where it was sent, and the hips have gone further from it than its leg reaches: let it free`,
      )
    }
    const { first, fold } = leg.reach(from)
    // (let go by the story, a leg swings out and comes round in time for its foot to come down)
    const within = footing.down ? 0 : footing.step?.remains
    leg.first.follow(first, delta, within)
    leg.second.follow(from.set(fold, 0, 0), delta, within)
  }

  /**
   * How the foot is turned against its shin (rad), the leg turned so: it lies on the ground, flat or on its ball. Off
   * it in a stride it hangs square to its shin, and where he `falls` toe down for the ground: no further than the
   * ground under it lets its toe or its heel, and as far as an ankle bends.
   */
  foot(thigh: number, shin: number, falls: boolean, delta: number) {
    const high = Math.max(0, this.end.value.y - SIZE.ankle)
    const [toe, heel] = [Math.min(HEEL, tipped(high, SOLE.ball)), tipped(high, SOLE.behind)]
    const hangs = this.pitch + ((falls ? toe : thigh + shin) - this.pitch) * Math.min(1, DROOP * delta)
    this.pitch = this.end.anchor ? this.heel : clamp(hangs, -heel, tipped(high, SOLE.ball))
    const [least, most] = RANGE.ankle.x
    return clamp(this.pitch - thigh - shin, -most, -least)
  }
}
