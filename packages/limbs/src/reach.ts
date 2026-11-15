import { Euler, Matrix3, Quaternion, Vector3 } from 'three'
import { AXES, type State, between, beyond, bounds } from './curve'
import { EASY, type Goal, REST } from './goal'
import { DOWN, type Touch, bends, bent } from './fingers'
import { type Target, Track, moves } from './track'
import { EXACT, NUDGE, type Xyz, clamp } from './world'

/**
 * how a limb's joints must be turned and turning for its end to be somewhere; how far short of there the limb is, or
 * less if it reaches further (m), and whether something keeps it from there: a joint that does not turn that far, the
 * trunk in its way, or a hand that cannot be turned so
 */
export type Aimed = { first: Turn; second: Turn; wrist?: Turn; short: number; stuck: boolean }
export type Turn = { value: Vector3; velocity: Vector3 }
/** how many times over the wrist is put nearer where it has a fingertip at its place, and how far it is moved to tell which way that is (m) */
const TIPS = { tries: 20, moved: 1e-6 }
/**
 * how far an arm swings its elbow out or in about the line from its shoulder to its hand at the most, and how finely
 * that is looked through (rad); how many times over the swing that turns a hand nearest is looked for between; and
 * what moving the elbow from where it is costs against a wrist turned short (rad a metre)
 */
const SWIVEL = { most: 1.2, fine: 0.1, tries: 12, moved: 0.1 }
/** a full turn (rad) */
export const FULL = 2 * Math.PI
/** what a wrist bends about to carry the fingers: to the side and back and forth, not the forearm's twist */
const BENDS = ['x', 'z'] as const
const start = new Vector3()
const turned = new Quaternion()
const forearm = new Quaternion()
const bend = new Quaternion()
const to = new Vector3()
const framed = new Quaternion()
const off = new Vector3()
const tried = new Vector3()
const near = new Vector3()
const column = new Vector3()
const rotation = new Euler()
const slope = new Matrix3()

/** how a forearm is turned in the frame of the body, on a trunk turned so: its arm turned and folded so */
const fore = (trunk: Quaternion, first: Xyz, fold: number, to: Quaternion) =>
  to
    .copy(trunk)
    .multiply(bend.setFromEuler(rotation.set(first.x, first.y, first.z)))
    .multiply(bend.setFromEuler(rotation.set(fold, 0, 0)))

/**
 * How a limb is turned for its end to be at a target: pointing there and folding, an arm's elbow swung out or in as
 * little as keeps it clear of the trunk and lets the wrist turn the hand as it is to be, and what keeps it from that.
 */
export class Reach extends Track {
  /** where what a target is sent with is `seconds` on, from where the end is, as its joints are turning: there, or at a part of the hand */
  protected tipped(target: Target, seconds: number, at: Vector3) {
    const { first, second, wrist } = this.limb
    const on = ({ value, velocity }: State) => new Vector3().copy(value).addScaledVector(velocity, seconds)
    return at.add(this.sits(target, seconds, on(first), on(second).x, wrist ? on(wrist) : REST))
  }

  /** where what a target is sent with is from the wrist `seconds` from now, the limb turned and folded so and the wrist bent so: none, sent with the wrist */
  protected sits({ with: touch }: Target, seconds: number, first: Xyz, fold: number, wrist: Xyz) {
    if (!touch || !this.limb.wrist) return new Vector3()
    this.root(seconds, start, turned)
    bent(fore(turned, first, fold, forearm), wrist, bend)
    return this.touch(touch, seconds).applyQuaternion(bend)
  }

  /** where a part of the hand is from the wrist `seconds` from now, in the frame of the hand */
  private touch(touch: Touch | Vector3, seconds: number) {
    if (touch instanceof Vector3) return touch.clone()
    const fingers = this.limb.hand?.fingers
    if (!fingers)
      throw new Error(`the ${this.name} is to be somewhere with its ${touch}, and its rig has no finger bones`)
    return fingers.tip(touch, seconds)
  }

  /**
   * How the limb is turned for its end to be at a place `seconds` from now: and the wrist of a hand, bent for it to be
   * turned as it is to be, or at rest, and on by a `whip`. Sent with a part of the hand, the wrist is looked for from
   * the place a step at a time, each as far as the last was off by how that changes from place to place. What is said of how the hand is turned is turned as `ways` are.
   */
  private turns(target: Target, place: Vector3, seconds: number, ways: Quaternion, whip?: Vector3, kept?: number) {
    const { limb } = this
    const { hand } = limb
    this.root(seconds, start, turned)
    const [hangs, back] = [turned.clone(), turned.clone().invert()]
    const tip = target.with && this.touch(target.with, seconds)
    const [palm, pointing] = [target.palm, target.pointing].map((way) => way?.clone().applyQuaternion(ways))
    const turns = palm || pointing
    const lies = new Quaternion()
    const arm = (at: Vector3) => {
      to.copy(at).sub(start).applyQuaternion(back)
      const posed = {
        first: new Vector3(),
        fold: 0,
        wrist: hand && new Vector3(),
        forearm: new Quaternion(),
        stuck: false,
        swivel: 0,
      }
      /**
       * the arm posed with the elbow swung out so far: how far its wrist would turn beyond what it turns to turn the hand
       * so (rad), or Infinity in the trunk
       */
      const poses = (swivel: number) => {
        posed.swivel = swivel
        const { first, fold } = limb.reach(to, swivel)
        posed.first.copy(first)
        posed.fold = fold
        fore(hangs, first, fold, posed.forearm)
        const clear = !limb.inside(first, fold)
        if (!hand || !posed.wrist) return clear ? 0 : Infinity
        const turn = turns && bends(posed.forearm, hand.palm, palm, pointing)
        posed.stuck = Boolean(turns && !turn)
        posed.wrist.copy(turn || REST)
        bent(posed.forearm, posed.wrist.add(whip ?? REST), lies)
        return clear ? (turn ? beyond(turn, hand.wrist.range) : 0) : Infinity
      }
      // (swung so already, it is looked at swung so: how it moves is how that pose moves)
      if (kept !== undefined) {
        poses(kept)
        return posed
      }
      const fits = (swivel: number) => poses(swivel) === 0
      if (fits(0)) return posed
      // a hand the wrist cannot turn so, or an arm in the trunk, has the elbow swing out or in: as little as does, the
      // way that leaves the elbow nearer where it is if either does
      const elbow = limb.at(limb.first.value, limb.second.value.x, 0)
      const away = (swivel: number) => (poses(swivel), limb.at(posed.first, posed.fold, 0).distanceTo(elbow))
      for (let most = SWIVEL.fine; most < SWIVEL.most + EXACT; most += SWIVEL.fine) {
        const [way] = [1, -1].filter((way) => fits(way * most)).sort((one, other) => away(one * most) - away(other * most))
        if (!way) continue
        fits(way * between(most - SWIVEL.fine, most, (by) => !fits(way * by))[1])
        return posed
      }
      // and with none that does, as far as turns it nearest, clear of the trunk, with the elbow nearest where it is: so
      // it goes on from the swing it had
      const cost = (swivel: number) => poses(swivel) + SWIVEL.moved * limb.at(posed.first, posed.fold, 0).distanceTo(elbow)
      let [best, least] = [0, cost(0)]
      for (let swivel = -SWIVEL.most; swivel < SWIVEL.most + EXACT; swivel += SWIVEL.fine) {
        const by = cost(swivel)
        if (by < least) [best, least] = [swivel, by]
      }
      let [from, until] = [best - SWIVEL.fine, best + SWIVEL.fine]
      for (let k = 0; k < SWIVEL.tries; k++) {
        const [one, other] = [(2 * from + until) / 3, (from + 2 * until) / 3]
        if (cost(one) < cost(other)) until = other
        else from = one
      }
      poses((from + until) / 2)
      return posed
    }
    const at = place.clone()
    const misses = (wrist: Vector3, by: Vector3) => {
      arm(wrist)
      return by.subVectors(wrist, place).add(near.copy(tip ?? REST).applyQuaternion(lies))
    }
    for (let k = 0; tip && k < TIPS.tries && misses(at, off).length() > EXACT * NUDGE; k++) {
      const columns = [0, 1, 2].flatMap((axis) => {
        tried.copy(at).setComponent(axis, at.getComponent(axis) + TIPS.moved)
        return misses(tried, column).sub(off).divideScalar(TIPS.moved).toArray()
      })
      at.sub(off.applyMatrix3(slope.fromArray(columns).invert()))
      // (out of reach, the wrist is looked for no further than the limb reaches, and what is still missing is short)
      if (at.distanceTo(start) > limb.length) at.sub(start).setLength(limb.length).add(start)
    }
    const missing = tip ? misses(at, off).length() : 0
    const posed = arm(at)
    const short = Math.max(at.distanceTo(start) - limb.length, missing > EXACT ? missing : -Infinity)
    return { ...posed, short }
  }

  /**
   * How the joints must be turned, and turning, for the end to be where a target is and moving as asked `seconds` from
   * now: and how far short of there the limb is, pointing at it, and what keeps it from being turned so.
   */
  protected solve(target: Target, seconds: number): Aimed {
    const here = this.turns(target, this.where(target, seconds, framed), seconds, framed)
    const state = (value: Vector3) => ({ value, velocity: new Vector3() })
    const [first, second] = [state(here.first), state(new Vector3(here.fold, 0, 0))]
    const wrist = here.wrist && state(here.wrist)
    // what arrives moving moves so in the scene, wherever its place is counted from; what stays goes with its place,
    // and with a thing as it moves. A hand that arrives moving turns on with it at the wrist
    const fast = moves(target)
    const then = this.where(target, fast ? seconds : seconds + NUDGE, framed)
    then.addScaledVector(fast ? target.velocity : REST, NUDGE)
    const whip = fast && here.wrist ? this.whip(here.forearm, here.wrist, target.velocity) : undefined
    const next = this.turns(target, then, seconds + NUDGE, framed, whip?.multiplyScalar(NUDGE), here.swivel)
    const stuck = here.stuck || this.stuck({ first, second, wrist })
    first.velocity.copy(next.first).sub(first.value)
    // the same way to point can read a full turn apart from one look to the next
    first.velocity.x -= FULL * Math.round(first.velocity.x / FULL)
    first.velocity.divideScalar(NUDGE)
    second.velocity.set((next.fold - here.fold) / NUDGE, 0, 0)
    if (wrist && next.wrist) wrist.velocity.copy(next.wrist).sub(wrist.value).divideScalar(NUDGE)
    return { first, second, wrist, short: here.short, stuck }
  }

  /**
   * how fast the wrist of a hand that arrives moving bends on with it: the way that carries the fingers along, as fast as
   * the end goes across a forearm's length, and no faster than it gets bending from as far back as it bends, at its ease
   */
  private whip(forearm: Quaternion, at: Vector3, velocity: Vector3) {
    const { wrist } = this.limb
    if (!wrist) return undefined
    const fingers = (turn: Vector3) => DOWN.clone().applyQuaternion(bent(forearm, turn, bend))
    const was = fingers(at)
    const moved = (axis: 'x' | 'z') => fingers(tried.copy(at).setComponent(AXES.indexOf(axis), at[axis] + NUDGE))
    const way = new Vector3(moved('x').sub(was).dot(velocity), 0, moved('z').sub(was).dot(velocity)).normalize()
    if (!(way.lengthSq() > 0)) return undefined
    let room = Infinity
    for (const axis of BENDS) {
      const [least, most] = wrist.range[axis] ?? [-Infinity, Infinity]
      if (way[axis] !== 0) room = Math.min(room, (at[axis] - (way[axis] > 0 ? least : most)) / way[axis])
    }
    const eased = Math.sqrt(2 * EASY * wrist.strength * Math.max(0, room))
    return way.multiplyScalar(Math.min(eased, velocity.length() / this.size.forearm))
  }

  /**
   * whether something keeps the limb from being turned so: a joint that does not turn that far, what it swings by read
   * as the turn that lies nearest the middle of how far it swings, or the trunk, which an arm does not pass through
   */
  protected stuck(turned: Record<'first' | 'second', { value: Vector3 }> & { wrist?: { value: Vector3 } }) {
    const { first, second, wrist } = this.limb
    const joints: [Goal, Vector3][] = [
      [first, turned.first.value],
      [second, turned.second.value],
    ]
    if (wrist && turned.wrist) joints.push([wrist, turned.wrist.value])
    const off = joints.some(([joint, to]) => !this.within(joint, to).equals(to))
    return off || this.limb.inside(turned.first.value, turned.second.value.x) !== undefined
  }

  /** the joints aimed as near as they turn to how they are aimed, and an arm as little off its trunk as clears it */
  protected near(aimed: Aimed) {
    const { first, second, wrist } = this.limb
    aimed.first.value.copy(this.within(first, aimed.first.value))
    aimed.second.value.copy(this.within(second, aimed.second.value))
    if (wrist && aimed.wrist) aimed.wrist.value.copy(this.within(wrist, aimed.wrist.value))
    this.limb.off(aimed.first.value, aimed.second.value.x)
  }

  /**
   * a joint turned so, what it swings by read as the turn that lies nearest the middle of how far it swings: and turned
   * as near that as it turns; or `well` within that, by as much as it may turn past it, read as the turn that lies
   * nearest how it is turned now
   */
  protected within(joint: Goal, to: Vector3, well = false) {
    const range = joint.range.x
    const middle = well ? joint.value.x : range && (range[0] + range[1]) / 2
    if (middle !== undefined && joint !== this.limb.wrist) to.x -= FULL * Math.round((to.x - middle) / FULL)
    return new Vector3().fromArray(
      AXES.map((axis) => {
        const [least, most] = well ? (joint.range[axis] ?? [-Infinity, Infinity]) : bounds(joint.range, axis)
        return clamp(to[axis], least, most)
      }),
    )
  }

  /**
   * where the wrist is to be for a target `seconds` from now and how the hand is to be turned there from hanging
   * straight down, in the frame of the body: as its palm is to face and its fingers to point
   */
  protected turned(plan: Target, seconds: number) {
    const at = this.where(plan, seconds, framed).clone()
    const hand = this.limb.hand
    const palm = plan.palm?.clone().applyQuaternion(framed)
    const pointing = plan.pointing?.clone().applyQuaternion(framed)
    const turn = hand && bends(new Quaternion(), hand.palm, palm, pointing)
    return { at, turned: bent(new Quaternion(), turn ?? REST, new Quaternion()) }
  }
}
