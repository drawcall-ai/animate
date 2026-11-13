import { Euler, Matrix3, Matrix4, Object3D, Quaternion, Vector3 } from 'three'
import { AXES, type State, between, bounds, inside, longest } from './curve'
import { EASY, type Goal, MOST, REST } from './goal'
import { DOWN, type Touch, bends, bent, rests } from './hand'
import type { Ahead } from './ahead'
import type { Limb } from './limb'
import type { Root } from './roots'
import { type Size, tick } from './size'
import type { Stoop } from './stoop'
import { UP } from './hips'
import { EXACT, GRAVITY, NUDGE, type Xyz, clamp, steps } from './world'

/**
 * where an end is sent, and how it is to move there: a place `on` him is counted from where its limb starts, as he
 * faces, and one on a thing in its frame. A hand may be turned for its `palm` to face and for it to be `pointing` a
 * way, and be sent to be there `with` a part of it other than the wrist
 */
export type Target = {
  place: Vector3
  velocity: Vector3
  on?: 'him' | Object3D
  palm?: Vector3
  pointing?: Vector3
  with?: Touch
}
/**
 * what a body's places are told against: what takes the scene to the frame they are told in, the rig, and the bone the
 * limb starts at; and the body, which a place is on that is on him
 */
export type Rigged = { frame: Matrix4; rig: Object3D; limb: Object3D; body: object }
/**
 * how an end gets to a target: the moment it is there, the moment it sets off, how long it swings into a fast arrival,
 * drawn back first (s), what the body gets down for it, and whether it was there at its moment once that has come
 */
export type Plan = Target & { when: number; leaves: number; swing: number; stoop?: Stoop; there?: boolean }
/** the joints of a limb from its first out, the last at the wrist of a hand */
export const JOINTS = ['first', 'second', 'wrist'] as const
/**
 * how a limb's joints must be turned and turning for its end to be somewhere; how far short of there the limb is, or
 * less if it reaches further (m), and what keeps it from there, if something does: a joint that does not turn that
 * far, the trunk in its way, or a hand that cannot be turned so
 */
export type Aimed = { first: Turn; second: Turn; wrist?: Turn; short: number; stuck?: string }
type Turn = { value: Vector3; velocity: Vector3 }
type Turning = { first: State; second: State; wrist?: State }
/** how a joint is drawn back, and how long it swings from there (s) */
type Drawn = State & { value: Vector3; swing: number }
/** why there is no plan for a moment: how far the planning got, by how much it fell short, and what to say of it */
type Miss = { rank: number; by: number; say: string }
/** how far the planning gets with a moment: the limb reaches, its joints turn that far, it has had the time to swing at its ease, the body spares it, and its joints are strong enough */
const GOT = { reach: 0, turn: 1, ease: 2, spare: 3, strength: 4 }

/**
 * how much nearer than it has to he gets down for a limb, if he can, and a limb is to what it arrives at moving, at the
 * first moment it can: at full stretch it cannot move its end along itself (in lengths of his leg)
 */
const MARGIN = 0.034
/**
 * how far ahead the way the body is going is looked along for where a limb will reach, in his beats, and how finely, in
 * steps of his time; and how little changes from one look to the next when nothing will (m)
 */
const LOOK = { far: 200, fine: 4, same: 1e-4 }
/** how finely getting down is looked through for the least that has a limb reach, and drawing back for the most its joints turn: in shares of the most */
const FINE = 1 / 16
/** how many times over the wrist is put nearer where it has a fingertip at its place, and how far it is moved to tell which way that is (m) */
const TIPS = { tries: 20, moved: 1e-6 }
/** how far an arm swings its elbow out or in about the line from its shoulder to its hand at the most, and how finely that is looked through (rad) */
const SWIVEL = { most: 1.2, fine: 0.1 }
/** how long a thing is watched for how it moves, at the least (in his beats): updates tell how it moves no finer */
const WATCH = 0.09
const FULL = 2 * Math.PI
/** what a wrist bends about to carry the fingers: to the side and back and forth, not the forearm's twist */
const BENDS = ['x', 'z'] as const
const start = new Vector3()
const turned = new Quaternion()
const forearm = new Quaternion()
const bend = new Quaternion()
const to = new Vector3()
const there = new Vector3()
const carried = new Vector3()
const framed = new Quaternion()
const spun = new Quaternion()
const now = new Vector3()
const matrix = new Matrix4()
const off = new Vector3()
const tried = new Vector3()
const near = new Vector3()
const column = new Vector3()
const rotation = new Euler()
const slope = new Matrix3()
const ONE = new Vector3(1, 1, 1)

/** how a forearm is turned in the frame of the body, on a trunk turned so: its arm turned and folded so */
const fore = (trunk: Quaternion, first: Xyz, fold: number, to: Quaternion) =>
  to
    .copy(trunk)
    .multiply(bend.setFromEuler(rotation.set(first.x, first.y, first.z)))
    .multiply(bend.setFromEuler(rotation.set(fold, 0, 0)))

/** how long a limb takes to swing from one side to the other under its own weight, hanging from its first joint (s): the pace it moves at when it is at its ease */
export const sway = (limb: { length: number }) => Math.PI * Math.sqrt((2 * limb.length) / (3 * GRAVITY))

/**
 * how the joints are drawn back before a fast arrival, and how long each then swings: at rest, where a `swing` of so
 * long, speeding up evenly, has them turn as aimed. The limb is turned back as one about its first joint, the way that
 * is turning, and its second joint stretches out freely but folds only for as long as speeds it up at its ease, as the
 * wrist of a hand bends back: a limb swings long, and whips. With none, as aimed.
 */
export function drawn(aimed: Aimed, swing: number, limb: Limb): Record<'first' | 'second', Drawn> & { wrist?: Drawn } {
  const { first, second, wrist } = aimed
  if (!(swing > 0))
    return { first: { ...first, swing }, second: { ...second, swing }, wrist: wrist && { ...wrist, swing } }
  const turn = (at: number) => rotation.setFromVector3(to.copy(first.value).addScaledVector(first.velocity, at))
  const [was, on] = [new Quaternion().setFromEuler(turn(0)), turned.setFromEuler(turn(NUDGE))]
  const about = on.multiply(was.clone().invert())
  const axis = to.set(about.x, about.y, about.z)
  const angle = (-Math.atan2(axis.length(), about.w) * swing) / NUDGE
  const value = new Vector3().setFromEuler(
    rotation.setFromQuaternion(was.premultiply(on.setFromAxisAngle(axis.normalize(), angle))),
  )
  // (the same way to point, read as the turn nearest where it is to arrive from)
  value.x -= FULL * Math.round((value.x - first.value.x + (first.velocity.x * swing) / 2) / FULL)
  const eased = (turn: Turn, joint: Goal) => Math.min(swing, turn.velocity.length() / (EASY * joint.strength))
  const back = (turn: Turn, joint: Goal, late: number) => {
    const at = (axis: (typeof AXES)[number]) => {
      const [least, most] = joint.range[axis] ?? [-Infinity, Infinity]
      return clamp(turn.value[axis] - (turn.velocity[axis] * late) / 2, least, most)
    }
    return { value: new Vector3(at('x'), at('y'), at('z')), velocity: REST, swing: late }
  }
  const folds = second.value.x * second.velocity.x < 0
  return {
    first: { value, velocity: REST, swing },
    second: back(second, limb.second, folds ? eased(second, limb.second) : swing),
    wrist: wrist && limb.wrist && back(wrist, limb.wrist, eased(wrist, limb.wrist)),
  }
}

type Look = { at: Vector3; turned: Quaternion; large: Vector3; time: number }
type Seen = Look & { thing: Object3D; was: Look; past: Look[] }

const missed = (found: Plan | Miss): found is Miss => 'say' in found
export const moves = (target: Target) => target.velocity.lengthSq() > 0

/**
 * How the far end of a limb gets to where it is sent. A plan is made looking ahead along the way the body is going:
 * where the limb will start from then, how far the body has to get down for it to reach, when the body spares it, and
 * how long its joints take, each on its own smoothest way. With time to spare it sets off in time to turn at its ease,
 * as long as the limb sways under its own weight: before a fast arrival it first draws back so, as one limb about its
 * first joint, as far as its joints turn clear of the trunk, and swings from there. With less, it draws back only as
 * far as speeding up at its ease takes; with little, it sets off as late as the body spares it, and swings in one,
 * drawing back on its way.
 */
export class Planner {
  /** the plan it is carrying out: on its way, or staying where it came to rest */
  protected plan?: Plan
  /** the plans it has still to set off for, in the order they were sent: until one does, it goes on as it is */
  protected readonly waiting: Plan[] = []
  protected clock = 0
  /**
   * a thing it is on or sent to, as it was last seen from where its limb starts: where it is there, how it is turned
   * and how large it is, the moment it was seen, and how it was seen before
   */
  protected seen?: Seen

  /**
   * `name` is what it is called when it cannot do what is asked of it, on a body of a `size` whose places are told
   * against its `rig`; a foot stands on a `ground`, this high (m)
   */
  constructor(
    protected readonly name: string,
    protected readonly limb: Limb,
    protected readonly root: Root,
    protected readonly ahead: Ahead,
    protected readonly size: Size,
    protected readonly rig: Rigged,
    protected readonly ground?: number,
  ) {}

  /** whether the story has its limb: it has set off for somewhere, and has not arrived moving or been let `free` since */
  get held() {
    return this.plan !== undefined
  }

  protected get sent() {
    return this.plan ? [this.plan, ...this.waiting] : this.waiting
  }

  /** how soon it can set off for what it is sent to next (s from now): at the moment of what it was sent to last, and no sooner */
  protected get after() {
    return Math.max(0, (this.sent.at(-1)?.when ?? 0) - this.clock)
  }

  /** the body is told from when until when the story has the end: for all it is sent to, and a `plan` that is being made */
  protected claim(plan?: Plan) {
    const plans = plan ? [...this.sent, plan] : this.sent
    const last = plans.at(-1)
    if (this.root.leg) this.root.take(plans[0]?.leaves, last && moves(last) ? last.when : Infinity)
  }

  /** where what a target is sent with is `seconds` on, from where the end is, as its joints are turning: there, or at a part of the hand */
  protected tipped({ with: touch }: Target, seconds: number, at: Vector3) {
    const { first, second, wrist, hand } = this.limb
    if (!touch || !wrist || !hand?.fingers) return at
    const on = ({ value, velocity }: State) => new Vector3().copy(value).addScaledVector(velocity, seconds)
    this.root.at(seconds, start, turned)
    bent(fore(turned, on(first), on(second).x, forearm), on(wrist), bend)
    return at.add(hand.fingers.tip(touch, seconds).applyQuaternion(bend))
  }

  /**
   * where a target is `seconds` from now, and how what is said of it is turned, `ways`: a place on him goes with the
   * way he faces, and one on a thing is where the thing is from where the limb starts, moving on there as it was seen
   * to until now, and for an end that stays on it, on until then
   */
  protected where(target: Plan | Target, seconds: number, ways = framed) {
    const { place, on } = target
    if (on instanceof Object3D) {
      const { at, turned: held, large, time, was } = this.seen?.thing === on ? this.seen : this.see(on)
      // (on as it went from how it was seen before to how it is: for as long again as that took, as far again)
      const gone = this.ahead.now - time + ('there' in target && target.there ? seconds : 0)
      const again = was.time < time ? 1 + gone / (time - was.time) : 1
      now.lerpVectors(was.at, at, again)
      spun.slerpQuaternions(was.turned, held, again)
      this.root.at(seconds, start, turned)
      ways.copy(turned).multiply(spun)
      return there
        .copy(place)
        .applyMatrix4(matrix.compose(now, spun, large))
        .applyQuaternion(turned)
        .add(start)
    }
    if (!on) {
      ways.identity()
      return there.copy(place)
    }
    ways.setFromAxisAngle(UP, this.ahead.facing(seconds))
    return this.root.at(seconds, there, turned).add(carried.copy(place).applyQuaternion(ways))
  }

  /**
   * Looks at a thing from where the limb starts now, and tells how it was seen before: as long ago as it has been
   * watched for, back to a watch ago, as updates tell how it moves no finer
   */
  protected see(thing: Object3D) {
    this.holds(thing)
    thing.updateWorldMatrix(true, false)
    this.root.at(0, start, turned)
    const look = { at: new Vector3(), turned: new Quaternion(), large: new Vector3(), time: this.ahead.now }
    matrix.compose(start, turned, ONE).invert().multiply(this.rig.frame).multiply(thing.matrixWorld)
    matrix.decompose(look.at, look.turned, look.large)
    const before = this.seen?.thing === thing ? this.seen.past : []
    const past = before.filter(({ time }) => time >= look.time - WATCH * this.size.beat)
    return (this.seen = { ...look, thing, was: past[0] ?? before.at(-1) ?? look, past: [...past, look] })
  }

  protected holds(thing: Object3D) {
    let top = thing
    for (; top.parent; top = top.parent) {
      if (top === this.rig.limb) throw new Error(`the ${this.name} is sent to a thing that hangs from its own limb`)
    }
    let mine = this.rig.rig
    while (mine.parent) mine = mine.parent
    if (top !== mine) throw new Error(`the ${this.name} is to be on a thing that is not in the scene he is in`)
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
    this.root.at(seconds, start, turned)
    const [hangs, back] = [turned.clone(), turned.clone().invert()]
    const tip = target.with && hand?.fingers?.tip(target.with, seconds)
    const [palm, pointing] = [target.palm, target.pointing].map((way) => way?.clone().applyQuaternion(ways))
    const turns = palm || pointing
    // (closed around something, what points is what they hold)
    const along = pointing && hand?.fingers?.held
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
        const turn = turns && bends(posed.forearm, hand.palm, palm, pointing, along)
        posed.stuck =
          turns && !turn ? `the ${hand.wrist.name} cannot turn its hand so: say a palm across where it points` : ''
        if (turn) posed.wrist.copy(turn)
        else rests(hand, posed.wrist)
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
    const lost = missing > EXACT && `its ${target.with} does not come there: send it nearer`
    const posed = arm(at, far)
    const short = Math.max(at.distanceTo(start) - limb.length, lost ? missing : -Infinity)
    return { ...posed, short, stuck: lost || posed.stuck }
  }

  /**
   * How the joints must be turned, and turning, for the end to be where a target is and moving as asked `seconds` from
   * now: and how far short of there the limb is, pointing at it, and what keeps it from being turned so. Or turning as
   * the limb goes `on` from there as one: its end moving as asked across it, and no nearer or further.
   */
  protected solve(target: Target, seconds: number, on = false): Aimed {
    const here = this.turns(target, this.where(target, seconds), seconds, framed)
    const state = (value: Vector3) => ({ value, velocity: new Vector3() })
    const [first, second] = [state(here.first), state(new Vector3(here.fold, 0, 0))]
    const wrist = here.wrist && state(here.wrist)
    // what arrives moving moves so in the scene, wherever its place is counted from; what stays goes with its place,
    // and with a thing as it moves. A hand that arrives moving turns on with it at the wrist
    const fast = moves(target)
    const then = this.where(target, fast ? seconds : seconds + NUDGE)
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
  private stuck(turned: Record<'first' | 'second', { value: Vector3 }> & { wrist?: { value: Vector3 } }) {
    const { limb } = this
    const { first, second, wrist } = limb
    const joints: [Goal, Vector3][] = [
      [first, turned.first.value],
      [second, turned.second.value],
    ]
    if (wrist && turned.wrist) joints.push([wrist, turned.wrist.value])
    for (const [joint, to] of joints) {
      const range = joint.range.x
      if (range && joint !== wrist) to.x -= FULL * Math.round((to.x - (range[0] + range[1]) / 2) / FULL)
      for (const axis of AXES) {
        const [least, most] = bounds(joint.range, axis)
        if (to[axis] < least) return this.past(joint, axis, least - to[axis], false)
        if (to[axis] > most) return this.past(joint, axis, to[axis] - most, true)
      }
    }
    const into = limb.inside(turned.first.value, turned.second.value.x)
    const by = into && `${(Math.ceil(into.by * 100) / 100).toFixed(2)} m`
    return (
      into &&
      `the ${into.part} of the ${first.name} would be ${by} in the trunk: send the ${this.name} ${by} further ${into.way}`
    )
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

  /** how the body that steps with the end will have the joints turned and turning `seconds` from now: if it is the body's to step with */
  protected led(seconds: number): Turning | undefined {
    const { root } = this
    if (!root.leg || this.held) return undefined
    const place = root.stepped(seconds, new Vector3())
    const dt = tick(this.size)
    const velocity = root
      .stepped(seconds + dt, new Vector3())
      .sub(place)
      .divideScalar(dt)
    return this.solve({ place, velocity }, seconds)
  }

  /**
   * How the joints will be turned and turning when it sets off `seconds` from now: where the last it was sent to has it
   * stay, or as it goes on from arriving there moving; sent nowhere, as the body will have them that steps with the end
   * till then, or as they are.
   */
  private starts(seconds: number): Turning {
    const last = this.sent.at(-1)
    if (!last) return this.led(seconds) ?? this.limb
    return this.solve(last, moves(last) ? this.after : seconds, moves(last))
  }

  /**
   * how long the limb swings into a fast arrival, its joints speeding up evenly from rest (s), or 0 with no swing to it:
   * for as long as it swings down under its own weight, or if it is to be `brief`, as speeds them up at their ease, and no longer than has it
   * draw back as far as its joints turn, clear of the trunk
   */
  private swing(aimed: Aimed, brief: boolean) {
    const { limb } = this
    const eased = aimed.first.velocity.length() / (EASY * limb.first.strength)
    const most = brief ? Math.min(eased, sway(limb) / 2) : sway(limb) / 2
    let share = 0
    while (share < 1 && !this.stuck(drawn(aimed, (share + FINE) * most, limb))) share += FINE
    // (in less than two steps of his time the joints would draw back and never swing: an arrival so slow has none)
    return share * most < 2 * tick(this.size) ? 0 : share * most
  }

  /**
   * how hard the joint that has it hardest is pushed to turn as aimed in `seconds`, drawn back first if it is to
   * `swing` for so long, from how the joints are or will be: in times its strength
   */
  protected pushed(aimed: Aimed, seconds: number, swing: number, from: Turning = this.limb) {
    const { limb } = this
    const back = drawn(aimed, swing, limb)
    const takes = JOINTS.flatMap((joint) => {
      const [part, was, drawn, to] = [limb[joint], from[joint], back[joint], aimed[joint]]
      if (!part || !was || !drawn || !to) return []
      const times =
        drawn.swing > 0
          ? Math.max(part.takes(drawn, seconds - drawn.swing, was), part.takes(to, drawn.swing, drawn))
          : part.takes(to, seconds, was)
      return [{ joint: part, times }]
    })
    // (with no time at all, there is no telling how hard: that is the hardest)
    return takes.reduce((most, next) => (next.times > most.times || Number.isNaN(next.times) ? next : most))
  }

  /**
   * The plan for the first moment that has one, or what was missed at the first moment the limb reaches, or at the
   * first of all: with the body getting down for it if it `stoops`, which is looked for only once the limb reaches at
   * no moment otherwise.
   */
  protected scan(target: Target, stoops: boolean): Plan | Miss {
    const { ahead } = this
    const fine = LOOK.fine * tick(this.size)
    const first = this.after + fine
    // (getting down takes him a while: only a moment that leaves him that is as near as he will come)
    const down = stoops ? ahead.down : fine
    let last = this.fit(target, first, { stoops })
    if (!missed(last)) return last
    const missing = last
    let reached = last.rank > GOT.reach ? last : undefined
    // (a thing is looked ahead at only as it is from him now: what does not reach it or turn for it now does no later)
    for (
      let wait = first + fine;
      wait < LOOK.far * this.size.beat && !(target.on && last.rank < GOT.ease);
      wait += fine
    ) {
      const found = this.fit(target, wait, { stoops })
      if (!missed(found)) return found
      reached ??= found.rank > GOT.reach ? found : undefined
      // with the body at rest for as long as getting down takes him, and what is short as short as a moment ago, no later moment has a plan either
      const same = found.rank === last.rank && Math.abs(found.by - last.by) < LOOK.same
      if (same && ahead.goes(wait - down, wait) < LOOK.same) break
      last = found
    }
    return stoops || reached ? (reached ?? missing) : this.scan(target, true)
  }

  /**
   * The plan that has the end at a target after a `wait` of so many seconds, or what it misses by. If he `stoops` for
   * it, the body gets down as little as has the limb reach, and the joints have to turn that far. Then it sets off as
   * soon as the body spares it and it has been where it was sent before: then, if it is to be `direct`, and otherwise
   * no sooner than has it swing at its ease. With no moment `given`, a moment so soon that it could not is no moment
   * for it.
   */
  protected fit(
    target: Target,
    asked: number,
    { given = false, direct = false, stoops = given }: { given?: boolean; direct?: boolean; stoops?: boolean },
  ): Plan | Miss {
    const { root, ahead, limb, after } = this
    const [margin, dt] = [MARGIN * this.size.leg, tick(this.size)]
    // (a moment is a step of his time: the first at or after what is asked)
    const wait = steps(asked, dt) * dt
    const when = this.clock + wait
    const fast = moves(target)
    const until = fast ? when : Infinity
    // the rest of the body winds up for a fast arrival: which changes where he is going
    const wind = (leaves: number) =>
      fast && !root.leg && root.wind(leaves, when, this.where(target, wait), target.velocity)
    let upright = this.solve(target, wait)
    let aimed = upright
    let stoop: Stoop | undefined
    const stooped = (share: number) => {
      if (stoop) ahead.rise(stoop, -Infinity)
      stoop = root.stoop(share, this.where(target, wait), when, until, limb.length)
      wind(when)
      aimed = this.solve(target, wait)
      return aimed.short <= -margin
    }
    let plan: Plan | undefined
    const miss = (rank: number, by: number, say: string): Miss => {
      if (stoop) ahead.rise(stoop, -Infinity)
      if (!root.leg) root.unwind()
      if (plan) this.claim()
      const sent = `the ${this.name} is sent to ${this.spot(target, wait)}, and ${wait.toFixed(2)} s on`
      return { rank, by, say: `${sent} ${say}` }
    }
    // (what arrives moving at the first moment it can is short of its stretch: he gets down for that too)
    const near = fast && !given ? -margin : EXACT
    const unreached = (most = near) => {
      if (aimed.short > most) {
        return miss(
          GOT.reach,
          upright.short,
          `its limb is ${Math.max(aimed.short, upright.short).toFixed(2)} m short of there, and he does not get down far enough for it: have the body come nearer first, or send it nearer`,
        )
      }
      if (!aimed.stuck) return undefined
      return miss(GOT.turn, 0, aimed.stuck)
    }
    // the least he has to get down: further down can be further off again, so it is looked for from upright on
    let short: Miss | undefined
    if (stoops && upright.short > near) {
      // (how far, and whether it reaches, is told from how he would wind up with all the time for it)
      wind(when)
      aimed = upright = this.solve(target, wait)
      for (let share = FINE; upright.short > near && share <= 1 && !stooped(share); share += FINE);
      short = unreached()
      if (!root.leg) root.unwind()
      if (!short) aimed = this.solve(target, wait)
    } else short = unreached()
    if (short) return short
    // it sets off in time to turn at its ease, from how it will be then, for no longer than keeps its joints within how far they turn: twice round is near enough. Within a look of as soon as it can, it sets off then: and no sooner than the body spares it, a foot it stands on
    let [easy, leaves] = [0, after]
    const spared = (from: number) => {
      if (root.leg && !this.held) while (from < wait && !root.spare(from, wait)) from += dt
      return from
    }
    const sets = (swing: number, most: number) => {
      const to = drawn(aimed, swing, limb)
      const soonest = (leaves = direct ? after : spared(Math.max(after, wait - swing - most)))
      for (let k = 0; k < 2; k++) {
        const from = this.starts(leaves)
        const draws = (joint: 'first' | 'second') => longest(from[joint], to[joint], most, limb[joint].range)
        easy = swing + Math.min(draws('first'), draws('second'))
        if (!direct) leaves = spared(wait - easy < after + LOOK.fine * dt ? after : Math.max(soonest, wait - easy))
      }
    }
    // as long as the limb sways: and before a fast arrival, that long to draw back as far as its joints turn, and then it swings
    let swing = fast ? this.swing(aimed, false) : 0
    sets(swing, sway(limb))
    // with less time than that it draws back in half of it, and only as far as it swings from at its ease
    if (fast && wait - leaves < easy - EXACT) sets((swing = this.swing(aimed, true)), sway(limb) / 2)
    if (!given && wait - after < easy - EXACT) {
      const from = after > 0 ? `where it was sent before, which it is kept at ${after.toFixed(2)} s yet` : 'where it is'
      const help = `send it by a moment ${(easy - wait + after).toFixed(2)} s later, or nearer${after > 0 ? ', or free it first' : ''}`
      const takes = `its limb takes ${easy.toFixed(2)} s from ${from} to get there at its ease, and has ${(wait - after).toFixed(2)}`
      return miss(GOT.ease, easy - wait + after, `${takes}: ${help}`)
    }
    // and with less than that it swings in one, drawing back on its way
    if (fast && wait - leaves < easy - EXACT) sets((swing = 0), 2 * sway(limb))
    if (leaves >= wait) return miss(GOT.spare, 0, 'he stands on it until then: send it later, or plant the other foot')
    // the body does not step with a foot the story has, and the rest of it winds up for a fast arrival the limb draws back for: which changes where he is going, and leaves the limb less to do
    const from = this.starts(leaves)
    plan = { ...target, when, leaves: this.clock + leaves, swing, stoop }
    this.claim(plan)
    const wound = swing > 0 && wind(plan.leaves)
    aimed = this.solve(target, wait)
    short = unreached(EXACT)
    if (short) return short
    const turns = this.pushed(aimed, wait - leaves, swing, from)
    const takes = wound && wound.times > turns.times ? wound : turns
    // (with no time at all, there is no telling how hard)
    if (!(takes.times <= MOST)) {
      const less = fast
        ? 'it to arrive slower, or moving more across its limb: a limb swings its end across itself far faster than it stretches'
        : 'a place nearer where it is'
      const help = `${given ? 'Give it longer, or ask' : 'Ask'} for ${less}`
      return miss(GOT.strength, takes.times, `${this.cannot(takes, wait - leaves, fast)}. ${help}`)
    }
    return plan
  }

  protected spot(target: Target, seconds: number) {
    const places = this.where(target, seconds).toArray()
    return `(${places.map((n) => n.toFixed(2)).join(', ')})`
  }

  protected cannot({ joint, times }: { joint: Goal; times: number }, seconds: number, moving: boolean) {
    return `it cannot be where it is to be in the ${seconds.toFixed(2)} s it has${moving ? ', moving as it is to' : ''}: the ${joint.name} would have to be pushed ${times.toFixed(1)} times as hard as it can be`
  }
}
