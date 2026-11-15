import { Euler, Matrix3, Quaternion, Vector3 } from 'three'
import { AXES, type State, between, bounds, inside } from './curve'
import { EASY, type Goal, REST } from './goal'
import { DOWN, type Finger, bends, bent } from './fingers'
import { type Target, Track, moves } from './track'
import { EXACT, NUDGE, type Xyz, clamp } from './world'

/**
 * how a limb's joints must be turned and turning for its end to be somewhere; how far short of there the limb is, or
 * less if it reaches further (m), and what keeps it from there, if something does: a joint that does not turn that
 * far, the trunk in its way, or a hand that cannot be turned so
 */
export type Aimed = { first: Turn; second: Turn; wrist?: Turn; short: number; stuck?: string }
export type Turn = { value: Vector3; velocity: Vector3 }
/** how many times over the wrist is put nearer where it has a fingertip at its place, and how far it is moved to tell which way that is (m) */
const TIPS = { tries: 20, moved: 1e-6 }
/** how far an arm swings its elbow out or in about the line from its shoulder to its hand at the most, and how finely that is looked through (rad) */
const SWIVEL = { most: 1.2, fine: 0.1 }
/** how far short of its stretch the nearest place a hand can be at is looked for, in shares of its limb */
const SHORT = 0.015
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
  protected tipped({ with: touch }: Target, seconds: number, at: Vector3) {
    const { first, second, wrist } = this.limb
    if (!touch || !wrist) return at
    const on = ({ value, velocity }: State) => new Vector3().copy(value).addScaledVector(velocity, seconds)
    this.root(seconds, start, turned)
    bent(fore(turned, on(first), on(second).x, forearm), on(wrist), bend)
    return at.add(this.touch(touch, seconds).applyQuaternion(bend))
  }

  /** where a part of the hand is from the wrist `seconds` from now, in the frame of the hand */
  private touch(touch: Finger | 'palm' | Vector3, seconds: number) {
    if (touch instanceof Vector3) return touch.clone()
    const fingers = this.limb.hand?.fingers
    if (!fingers)
      throw new Error(`the ${this.name} is to be somewhere with its ${touch}, and its rig has no finger bones`)
    return fingers.tip(touch, seconds)
  }

  /**
   * How the limb is turned for its end to be at a place `seconds` from now, or toward it, as `far` from where the limb
   * starts: and the wrist of a hand, bent for it to be turned as it is to be, or at rest, and on by a `whip`. Sent
   * with a part of the hand, the wrist is looked for from the place a step at a time, each as far as the last was off
   * by how that changes from place to place. What is said of how the hand is turned is turned as `ways` are.
   */
  private turns(target: Target, place: Vector3, seconds: number, ways: Quaternion, far?: number, whip?: Vector3) {
    const { limb } = this
    const { hand } = limb
    this.root(seconds, start, turned)
    const [hangs, back] = [turned.clone(), turned.clone().invert()]
    const tip = target.with && this.touch(target.with, seconds)
    const [palm, pointing] = [target.palm, target.pointing].map((way) => way?.clone().applyQuaternion(ways))
    const turns = palm || pointing
    const lies = new Quaternion()
    const arm = (at: Vector3, far?: number) => {
      to.copy(at).sub(start).applyQuaternion(back)
      if (far !== undefined) to.setLength(far)
      const posed = {
        first: new Vector3(),
        fold: 0,
        wrist: hand && new Vector3(),
        forearm: new Quaternion(),
        stuck: '',
      }
      /** whether the arm, posed with the elbow swung out so far, is clear of the trunk, its wrist turning the hand so */
      const fits = (swivel: number) => {
        const { first, fold } = limb.reach(to, swivel)
        posed.first.copy(first)
        posed.fold = fold
        fore(hangs, first, fold, posed.forearm)
        const clear = !limb.inside(first, fold)
        if (!hand || !posed.wrist) return clear
        const turn = turns && bends(posed.forearm, hand.palm, palm, pointing, target.along)
        posed.stuck =
          turns && !turn ? `the ${hand.wrist.name} cannot turn its hand so: say a palm across where it points` : ''
        posed.wrist.copy(turn || REST)
        bent(posed.forearm, posed.wrist.add(whip ?? REST), lies)
        return clear && (!turn || inside(turn, hand.wrist.range))
      }
      if (fits(0)) return posed
      // a hand the wrist cannot turn so, or an arm in the trunk, has the elbow swing out or in: as little as does
      for (let most = SWIVEL.fine; most < SWIVEL.most + EXACT; most += SWIVEL.fine) {
        const way = [1, -1].find((way) => fits(way * most))
        if (!way) continue
        fits(way * between(most - SWIVEL.fine, most, (by) => !fits(way * by))[1])
        return posed
      }
      fits(0)
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
    const posed = arm(at, far)
    const short = Math.max(at.distanceTo(start) - limb.length, missing > EXACT ? missing : -Infinity)
    return { ...posed, short }
  }

  /**
   * How the joints must be turned, and turning, for the end to be where a target is and moving as asked `seconds` from
   * now: and how far short of there the limb is, pointing at it, and what keeps it from being turned so. Or turning as
   * the limb goes `on` from there as one: its end moving as asked across it, and no nearer or further.
   */
  protected solve(target: Target, seconds: number, on = false): Aimed {
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
    const far = on ? here.short + this.limb.length : undefined
    const next = this.turns(target, then, seconds + NUDGE, framed, far, whip?.multiplyScalar(NUDGE))
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
   * what keeps the limb from being turned so, if something does: a joint that does not turn that far, what it swings by
   * read as the turn that lies nearest the middle of how far it swings, or the trunk, which an arm does not pass
   * through
   */
  protected stuck(turned: Record<'first' | 'second', { value: Vector3 }> & { wrist?: { value: Vector3 } }) {
    const { limb } = this
    const { first, second, wrist } = limb
    const joints: [Goal, Vector3][] = [
      [first, turned.first.value],
      [second, turned.second.value],
    ]
    if (wrist && turned.wrist) joints.push([wrist, turned.wrist.value])
    for (const [joint, to] of joints) {
      const near = this.within(joint, to)
      const axis = AXES.find((axis) => near[axis] !== to[axis])
      if (axis) return this.past(joint, axis, Math.abs(to[axis] - near[axis]), to[axis] > near[axis])
    }
    const into = limb.inside(turned.first.value, turned.second.value.x)
    const by = into && `${(Math.ceil(into.by * 100) / 100).toFixed(2)} m`
    return (
      into &&
      `the ${into.part} of the ${first.name} would be ${by} in the trunk: send the ${this.name} ${by} further ${into.way}`
    )
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
   * Where the end is to be for a target `seconds` from now, in the frame of the body, and the nearest place to that where the limb
   * can have it: short of its stretch, its joints well within how far they turn and the limb clear of the trunk, so
   * that it is turned so however finely it is a little off; or, `held` after a step, where it is. And what turns the
   * hand from how it is to be turned to how it can be, or is
   */
  protected closest(plan: Target, seconds: number, held: boolean) {
    const { limb } = this
    const want = this.where(plan, seconds, framed).clone()
    // (short of its stretch, so that it is turned so however finely it is a little off)
    this.root(seconds, start, turned)
    const near = want
      .clone()
      .sub(start)
      .clampLength(0, (1 - SHORT) * limb.length)
      .add(start)
    const posed = this.turns(plan, near, seconds, framed)
    const { first, second, wrist } = limb
    const well = (joint: Goal, to: Vector3) => (held ? joint.value : this.within(joint, to, true))
    const [turn, fold] = [well(first, posed.first), well(second, new Vector3(posed.fold, 0, 0)).x]
    const can = limb.at(held ? turn : limb.off(turn, fold), fold)
    const was = bent(posed.forearm, posed.wrist ?? new Vector3(), new Quaternion()).invert()
    const hand = bent(fore(turned, turn, fold, forearm), wrist ? well(wrist, posed.wrist ?? new Vector3()) : REST, bend)
    return { want, can: can.applyQuaternion(turned).add(start), turn: was.premultiply(hand) }
  }

  /** what an error says of a joint that would turn `by` rad past how far it turns about an `axis`, at the `most` it turns or the least */
  private past(joint: Goal, axis: (typeof AXES)[number], by: number, most: boolean) {
    const { second, wrist } = this.limb
    const rad = (Math.ceil(by * 100) / 100).toFixed(2)
    const far = `${rad} rad further`
    const name = `the ${joint.name} would`
    if (joint === wrist) {
      if (axis === 'y') return `${name} twist the forearm ${far} than it does: have the palm face ${far} back round`
      const bend =
        axis === 'x'
          ? `bend the hand ${far} to the side of its ${most ? 'little finger' : 'thumb'}`
          : `fold the hand ${far}`
      return `${name} ${bend} than it does: have it point ${rad} rad nearer along the forearm`
    }
    if (joint === second)
      return `${name} fold ${far} than it does: send the ${this.name} further from where its limb starts`
    if (axis !== 'x') return `${name} turn ${far} round than it does: send the ${this.name} nearer in front of him`
    return `${name} swing ${far} ${most ? 'back' : 'up'} than it does: send the ${this.name} further ${most ? 'forward' : 'down'}`
  }
}
