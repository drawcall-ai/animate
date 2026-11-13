import { Euler, Vector3 } from 'three'
import { THICK } from './figure'
import type { Goal } from './goal'
import { SIZE } from './size'
import { clamp } from './world'

/** how much of its length a limb stretches to at the most, and how much further than straight back on itself it folds to at the least (m): its middle joint is never quite straight nor shut */
const STRETCH = { most: 0.999, least: 0.01 }
/** how far off a plan may turn out when it is carried out, the body being not quite where it was looked ahead to be: how far short of where its end is to be a limb may come (m), how much harder than a plan may ask a joint may be pushed (in times its strength), and how far from where it was sent an end may be at its moment (m), or off the speed it was to have there, in shares of it */
export const SLACK = { reach: 0.02, push: 0.2, place: 0.05, speed: 0.05 }
const first = new Vector3()

/** the corner of a triangle opposite the side `across`, between the sides `a` and `b` (rad) */
const corner = (a: number, b: number, across: number) =>
  Math.acos(Math.min(1, Math.max(-1, (a * a + b * b - across * across) / (2 * a * b))))

/** A limb of two parts, a leg or an arm: the joints its parts turn at, how long they are, which way its middle joint folds: `forward` is a knee; and for an arm, how far out from the middle of the trunk it hangs `beside` its first joint is (m). */
export class Limb {
  /** how long it is, from its first joint to its end (m) */
  readonly length: number

  constructor(
    readonly first: Goal,
    readonly second: Goal,
    private readonly upper: number,
    private readonly lower: number,
    private readonly forward: boolean,
    private readonly beside?: number,
  ) {
    this.length = upper + lower
  }

  /** whether an arm turned and folded so keeps its elbow, the middle of its forearm and its wrist clear of the trunk: outside it, as thick as it is drawn from the shoulders down, and not round behind it on the other side */
  clear(turned: Vector3, fold: number) {
    const { beside, upper } = this
    if (!beside) return true
    const turn = new Euler().setFromVector3(turned)
    return [0, this.lower / 2, this.lower].every((along) => {
      const { x, y, z } = new Vector3(0, -upper - along * Math.cos(fold), -along * Math.sin(fold)).applyEuler(turn)
      const [out, past] = [x + beside, y - clamp(y, THICK.trunk - SIZE.trunk, -THICK.trunk)]
      return Math.hypot(out, past, z) >= THICK.trunk && (past !== 0 || z > 0 || out * beside > 0)
    })
  }

  /**
   * How the limb turns for its end to come to a place: `to` is that place from the limb's first joint, in the frame
   * the limb hangs in. The limb points there, as far as it stretches, and folds at its middle joint, a knee ahead or
   * an elbow behind, which it keeps under the line to a place off to the side. Returns the rotation of the first
   * part (rad about x, y and z) and how far the second is folded against it (rad).
   */
  reach(to: Vector3) {
    const { upper, lower, forward } = this
    const far = to.length()
    const length = Math.min(STRETCH.most * (upper + lower), Math.max(Math.abs(upper - lower) + STRETCH.least, far))
    const fold = Math.PI - corner(upper, lower, length)
    const lean = corner(upper, length, lower)
    // where the end lies from the joint, folded so, before the first part is turned: down along it, and behind it or ahead
    const [along, across] = [length * Math.cos(lean), (forward ? -1 : 1) * length * Math.sin(lean)]
    // how far to the side the end is to be, the limb as long as it is folded to
    const aside = far > 0 ? (to.x / far) * length : 0
    // it is turned there the least way: twisted about itself as far as its fold carries the end to the side, and tilted sideways as far as its length does. So a folded limb keeps its middle joint under it, an elbow down or a knee ahead, and a straight one swings out
    const twist = Math.asin((aside / length) * (across / length))
    const tilt = Math.atan2(aside * along, length * Math.sqrt(Math.max(0, length * length - aside * aside)))
    // then it is swung forward or back onto the place, from where that has left the end
    const [down, ahead] = [along * Math.cos(tilt), across * Math.cos(twist) - along * Math.sin(tilt) * Math.sin(twist)]
    first.set(Math.atan2(ahead, down) - Math.atan2(to.z, -to.y), twist, tilt)
    return { first, fold: forward ? fold : -fold }
  }
}
