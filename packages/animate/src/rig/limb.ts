import { Euler, Quaternion, Vector3 } from 'three'
import type { Beside } from './bones'
import { between } from '@drawcall/plan'
import type { Goal } from './goal'
import type { Fingers } from './fingers'
import { deep } from './shape'
import { GRAVITY } from '@drawcall/gait'

/** how much of its length a limb stretches to at the most, and how much further than straight back on itself it folds to at the least: its middle joint is never quite straight nor shut */
const STRETCH = { most: 0.999, least: 0.011 }
/** how near where it is to be a limb's end counts as there (in lengths of his leg) */
export const NEAR = 0.057
/** how much of its length a limb reaches without stretching */
export const REACH = 0.97
const first = new Vector3()
const turn = new Euler()
const swung = new Quaternion()
const about = new Quaternion()
const axis = new Vector3()

/** how long a limb takes to swing from one side to the other under its own weight, hanging from its first joint (s): the pace it moves at when it is at its ease */
export const sway = (limb: { length: number }) => Math.PI * Math.sqrt((2 * limb.length) / (3 * GRAVITY))

/** the corner of a triangle opposite the side `across`, between the sides `a` and `b` (rad) */
const corner = (a: number, b: number, across: number) =>
  Math.acos(Math.min(1, Math.max(-1, (a * a + b * b - across * across) / (2 * a * b))))

/**
 * the hand at the end of an arm: the joint it turns at against the forearm, the way its `palm` faces at rest, in the
 * frame of the forearm hanging straight down, and its fingers, if the rig has them
 */
type Handed = { wrist: Goal; palm: Vector3; fingers?: Fingers }

/**
 * A limb of two parts, a leg or an arm: the joints its parts turn at, how long they are, which way its middle joint
 * folds: `forward` is a knee; and for an arm, the `trunk` it hangs beside: on which `side` of it, its bands as the
 * arm's first joint has them, and how thick the upper arm and the forearm are (m), and the `hand` at its end.
 */
export class Limb<Hand extends Handed | undefined = Handed | undefined> {
  /** how long it is, from its first joint to its end (m) */
  readonly length: number

  constructor(
    readonly first: Goal,
    readonly second: Goal,
    readonly upper: number,
    readonly lower: number,
    private readonly forward: boolean,
    private readonly trunk: { side: number; bands: Beside[]; upper: number; fore: number } | undefined,
    readonly hand: Hand,
  ) {
    this.length = upper + lower
  }

  /** the joint at its end, if it has one: the wrist of a hand, the last of its chain */
  get wrist(): Goal | undefined {
    return this.hand?.wrist
  }

  /** where a point of a limb turned and folded so is from its first joint, in the frame it hangs in: `along` its second part from the middle joint (m), at its end unless that is said */
  at(turned: Vector3, fold: number, along = this.lower) {
    const at = new Vector3(0, -this.upper - along * Math.cos(fold), -along * Math.sin(fold))
    return at.applyEuler(turn.setFromVector3(turned))
  }

  /**
   * what of an arm turned and folded so is in the trunk, if any: its elbow, the middle of its forearm or its wrist, how
   * far in it is (m), and the nearest way out, as he faces. The arm is as thick as it is, the trunk as it is shaped
   * band by band, upright, and an arm does not go round behind it to the other side
   */
  inside(turned: Vector3, fold: number) {
    const { trunk, lower } = this
    if (!trunk) return undefined
    for (const [part, along, thick] of [
      ['elbow', 0, trunk.upper],
      ['forearm', lower / 2, trunk.fore],
      ['wrist', lower, trunk.fore],
    ] as const) {
      const at = this.at(turned, fold, along)
      const band = trunk.bands.find(({ low, high }) => at.y >= low && at.y <= high)
      if (!band) continue
      const [x, z] = [at.x - band.x, at.z - band.z]
      const [by, side] = [deep(band, x, z) + thick, x > 0 ? 'to his left' : 'to his right']
      if (by > 0) return { part, by, way: Math.abs(x) > z ? side : 'ahead' }
      if (z <= 0 && x * trunk.side <= 0) return { part, by: Math.abs(x), way: side }
    }
    return undefined
  }

  /** an arm turned and folded so, held off the trunk out to its side as little as clears it, as far as it turns */
  off(turned: Vector3, fold: number) {
    const { trunk } = this
    const [, most] = this.first.range.z ?? [-Infinity, Infinity]
    if (!trunk || !this.inside(turned, fold)) return turned
    const [, clear] = between(turned.z, trunk.side * most, (z) => this.inside(turned.setZ(z), fold) !== undefined)
    return turned.setZ(clear)
  }

  /**
   * How the limb turns for its end to come to a place: `to` is that place from the limb's first joint, in the frame
   * the limb hangs in. The limb points there, as far as it stretches, and folds at its middle joint, a knee ahead or
   * an elbow behind, which it keeps under the line to a place off to the side, and swings out or in about that line by
   * a `swivel` (rad). Returns the rotation of the first part (rad about x, y and z) and how far the second is folded
   * against it (rad).
   */
  reach(to: Vector3, swivel = 0) {
    const { upper, lower, forward } = this
    const far = to.length()
    const whole = upper + lower
    const length = Math.min(STRETCH.most * whole, Math.max(Math.abs(upper - lower) + STRETCH.least * whole, far))
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
    if (swivel && far > 0) {
      const x = first.x
      swung.setFromAxisAngle(axis.copy(to).normalize(), swivel)
      first.setFromEuler(turn.setFromQuaternion(swung.multiply(about.setFromEuler(turn.setFromVector3(first)))))
      // (the same way to point, read as the turn nearest the one it swings from)
      first.x -= 2 * Math.PI * Math.round((first.x - x) / (2 * Math.PI))
    }
    return { first, fold: forward ? fold : -fold }
  }
}
