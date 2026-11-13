import { Euler, Quaternion, Vector3 } from 'three'
import { type State, inside, longest } from './curve'
import { EASY, type Goal, MOST, REST } from './goal'
import type { Limb } from './limb'
import type { Root } from './roots'
import { DOWN_IN, type Stoop } from './stoop'
import { GRAVITY, NUDGE, TICK, clamp } from './world'

/** where an end is sent, and how it is to move there: a `carried` place is counted from where its limb starts */
export type Target = { place: Vector3; velocity: Vector3; carried: boolean }
/** how an end gets to a target: the moment it is there, the moment it sets off, how long it swings into a fast arrival, drawn back first (s), what the body gets down for it, and whether it was there at its moment once that has come */
export type Plan = Target & { when: number; leaves: number; swing: number; stoop?: Stoop; there?: boolean }
/** how a limb's joints must be turned and turning for its end to be somewhere, how far short of there the limb is, or less if it reaches further (m), and what keeps it from there, if something does: a joint that does not turn that far, or the trunk in its way */
export type Aimed = { first: Turned; second: Turned; short: number; stuck?: string }
type Turned = { value: Vector3; velocity: Vector3 }
/** how a limb's two joints are turned and turning */
type Turning = { first: State; second: State }
/** how a joint is drawn back, and how long it swings from there (s) */
type Drawn = State & { value: Vector3; swing: number }
/** why there is no plan for a moment: how far the planning got, by how much it fell short, and what to say of it */
type Miss = { rank: number; by: number; say: string }
/** how far the planning gets with a moment: the limb reaches, its joints turn that far, it has had the time to swing at its ease, the body spares it, and its joints are strong enough */
const GOT = { reach: 0, turn: 1, ease: 2, spare: 3, strength: 4 }

/** how much nearer than it has to he gets down for a limb, if he can, and a limb is to what it arrives at moving, at the first moment it can: at full stretch it cannot move its end along itself (m) */
const MARGIN = 0.03
/** how far short a limb that reaches is, for what numbers round to (m) */
const EXACT = 1e-6
/** how far ahead, and how finely, the way the body is going is looked along for where a limb will reach (s); and how little changes from one look to the next when nothing will (m) */
const LOOK = { far: 60, fine: 0.02, same: 1e-4 }
/** how finely getting down is looked through for the least that has a limb reach, and drawing back for the most its joints turn: in shares of the most */
const FINE = 1 / 16
const FULL = 2 * Math.PI
const start = new Vector3()
const turned = new Quaternion()
const to = new Vector3()
const there = new Vector3()
const rotation = new Euler()

/** how long a limb takes to swing from one side to the other under its own weight, hanging from its first joint (s): the pace it moves at when it is at its ease */
export const sway = (limb: { length: number }) => Math.PI * Math.sqrt((2 * limb.length) / (3 * GRAVITY))

/** how the joints are drawn back before a fast arrival, and how long each then swings: at rest, where a `swing` of so long, speeding up evenly, has them turn as aimed. The limb is turned back as one about its first joint, the way that is turning, and its second joint stretches out freely but folds only for as long as speeds it up at its ease: a limb swings long, and whips. With none, as aimed. */
export function drawn({ first, second }: Aimed, swing: number, limb: Limb): Record<'first' | 'second', Drawn> {
  if (!(swing > 0)) return { first: { ...first, swing }, second: { ...second, swing } }
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
  const folds = second.value.x * second.velocity.x < 0
  const late = folds ? Math.min(swing, second.velocity.length() / (EASY * limb.second.strength)) : swing
  const [least, most] = limb.second.range.x ?? [-Infinity, Infinity]
  const fold = new Vector3(clamp(second.value.x - (second.velocity.x * late) / 2, least, most), 0, 0)
  return { first: { value, velocity: REST, swing }, second: { value: fold, velocity: REST, swing: late } }
}

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

  /** `name` is what it is called when it cannot do what is asked of it; a foot stands on a `ground`, this high (m) */
  constructor(
    protected readonly name: string,
    protected readonly limb: Limb,
    protected readonly root: Root,
    protected readonly ground?: number,
  ) {}

  /** whether the story has its limb: it has set off for somewhere, and has not arrived moving or been let `free` since */
  get held() {
    return this.plan !== undefined
  }

  /** all it has been sent to, in the order it was */
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
    this.root.take?.(plans[0]?.leaves, last && moves(last) ? last.when : Infinity)
  }

  /** where a target is in the world, `seconds` from now */
  protected where(target: Target, seconds: number) {
    if (!target.carried) return there.copy(target.place)
    return this.root.at(seconds, there, turned).add(target.place)
  }

  /**
   * How the joints must be turned, and turning, for the end to be where a target is and moving as asked `seconds` from
   * now: and how far short of there the limb is, pointing at it, and what keeps it from being turned so. Or turning as
   * the limb goes `on` from there as one: its end moving as asked across it, and no nearer or further.
   */
  protected solve(target: Target, seconds: number, on = false): Aimed {
    const { limb, root } = this
    root.at(seconds, start, turned)
    to.copy(this.where(target, seconds))
    const short = to.sub(start).length() - limb.length
    const here = limb.reach(to.applyQuaternion(turned.invert()))
    const first = { value: here.first.clone(), velocity: new Vector3() }
    const second = { value: new Vector3(here.fold, 0, 0), velocity: new Vector3() }
    // what arrives moving moves so in the scene, wherever its place is counted from; what stays goes with its place
    to.copy(this.where(target, moves(target) ? seconds : seconds + NUDGE)).addScaledVector(target.velocity, NUDGE)
    root.at(seconds + NUDGE, start, turned)
    to.sub(start).applyQuaternion(turned.invert())
    const next = limb.reach(on ? to.setLength(short + limb.length) : to)
    const stuck = this.stuck({ first, second })
    first.velocity.copy(next.first).sub(first.value)
    // the same way to point can read a full turn apart from one look to the next
    first.velocity.x -= FULL * Math.round(first.velocity.x / FULL)
    first.velocity.divideScalar(NUDGE)
    second.velocity.set((next.fold - here.fold) / NUDGE, 0, 0)
    return { first, second, short, stuck }
  }

  /** what keeps the limb from being turned so, if something does: a joint that does not turn that far, what it swings by read as the turn that lies nearest the middle of how far it swings, or the trunk, which an arm does not pass through */
  private stuck(turned: Record<'first' | 'second', { value: Vector3 }>) {
    const { limb } = this
    for (const joint of [limb.first, limb.second]) {
      const to = turned[joint === limb.first ? 'first' : 'second'].value
      const range = joint.range.x
      if (range) to.x -= FULL * Math.round((to.x - (range[0] + range[1]) / 2) / FULL)
      if (!inside(to, joint.range)) return `the ${joint.name} does not turn that far`
    }
    return limb.clear(turned.first.value, turned.second.value.x) ? undefined : 'its limb passes through the trunk'
  }

  /** how the body that steps with the end will have the joints turned and turning `seconds` from now: if it is the body's to step with */
  protected led(seconds: number): Turning | undefined {
    const { stepped } = this.root
    if (!stepped || this.held) return undefined
    const place = stepped(seconds, new Vector3())
    const velocity = stepped(seconds + TICK, new Vector3()).sub(place)
    velocity.divideScalar(TICK)
    return this.solve({ place, velocity, carried: false }, seconds)
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
   * how long the limb swings into a fast arrival, its joints speeding up evenly from rest (s): for as long as it swings
   * down under its own weight, or if it is to be `brief`, as speeds them up at their ease, and no longer than has it
   * draw back as far as its joints turn, clear of the trunk
   */
  private swing(aimed: Aimed, brief: boolean) {
    const { limb } = this
    const eased = aimed.first.velocity.length() / (EASY * limb.first.strength)
    const most = brief ? Math.min(eased, sway(limb) / 2) : sway(limb) / 2
    let share = 0
    while (share < 1 && !this.stuck(drawn(aimed, (share + FINE) * most, limb))) share += FINE
    return share * most
  }

  /** how hard the joint that has it hardest is pushed to turn as aimed in `seconds`, drawn back first if it is to `swing` for so long, from how the joints are or will be: in times its strength */
  protected pushed(aimed: Aimed, seconds: number, swing: number, { first, second }: Turning = this.limb) {
    const { limb } = this
    const back = drawn(aimed, swing, limb)
    const takes = (joint: Goal, from: State, back: Drawn, to: State) =>
      back.swing > 0
        ? Math.max(joint.takes(back, seconds - back.swing, from), joint.takes(to, back.swing, back))
        : joint.takes(to, seconds, from)
    const a = takes(limb.first, first, back.first, aimed.first)
    const b = takes(limb.second, second, back.second, aimed.second)
    return { joint: a > b ? limb.first : limb.second, times: Math.max(a, b) }
  }

  /**
   * The plan for the first moment that has one, or of all that was missed, what came nearest: with the body getting
   * down for it if it `stoops`, which is looked for only once the limb reaches at no moment otherwise.
   */
  protected scan(target: Target, stoops: boolean): Plan | Miss {
    const { root } = this
    const first = this.after + LOOK.fine
    // (getting down takes him a while: only a moment that leaves him that is as near as he will come)
    const down = stoops ? DOWN_IN : LOOK.fine
    let last = this.fit(target, first, { stoops })
    if (!missed(last)) return last
    let nearest = last
    for (let wait = first + LOOK.fine; wait < LOOK.far; wait += LOOK.fine) {
      const found = this.fit(target, wait, { stoops })
      if (!missed(found)) return found
      if (found.rank > nearest.rank || (found.rank === nearest.rank && found.by < nearest.by)) nearest = found
      // with the body at rest for as long as getting down takes him, and what is short as short as a moment ago, no later moment has a plan either
      const same = found.rank === last.rank && Math.abs(found.by - last.by) < LOOK.same
      if (same && root.goes(wait - down, wait) < LOOK.same) break
      last = found
    }
    return stoops || nearest.rank !== GOT.reach ? nearest : this.scan(target, true)
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
    wait: number,
    { given = false, direct = false, stoops = given }: { given?: boolean; direct?: boolean; stoops?: boolean },
  ): Plan | Miss {
    const { root, limb, after } = this
    const when = this.clock + wait
    const fast = moves(target)
    const until = fast ? when : Infinity
    // the rest of the body winds up for a fast arrival: which changes where he is going
    const wind = (leaves: number) => fast && root.wind?.(leaves, when, this.where(target, wait), target.velocity)
    let upright = this.solve(target, wait)
    let aimed = upright
    let stoop: Stoop | undefined
    const stooped = (share: number) => {
      if (stoop) root.rise(stoop, -Infinity)
      stoop = root.stoop(share, this.where(target, wait), when, until, limb.length)
      wind(when)
      aimed = this.solve(target, wait)
      return aimed.short <= -MARGIN
    }
    let plan: Plan | undefined
    const miss = (rank: number, by: number, say: string): Miss => {
      if (stoop) root.rise(stoop, -Infinity)
      root.unwind?.()
      if (plan) this.claim()
      const sent = `the ${this.name} is sent to ${this.spot(target, wait)}, and ${wait.toFixed(2)} s on`
      return { rank, by, say: `${sent} ${say}` }
    }
    // (what arrives moving at the first moment it can is short of its stretch: he gets down for that too)
    const near = fast && !given ? -MARGIN : EXACT
    const unreached = (most = near) => {
      if (aimed.short > most) {
        return miss(
          GOT.reach,
          upright.short,
          `its limb is ${Math.max(aimed.short, upright.short).toFixed(2)} m short of there, and he does not get down far enough for it: have the body come nearer first, or send it nearer`,
        )
      }
      if (!aimed.stuck) return undefined
      return miss(GOT.turn, 0, `${aimed.stuck}: send it where its joints turn to, clear of the trunk`)
    }
    // the least he has to get down: further down can be further off again, so it is looked for from upright on
    let short: Miss | undefined
    if (stoops && upright.short > near) {
      // (how far, and whether it reaches, is told from how he would wind up with all the time for it)
      wind(when)
      aimed = upright = this.solve(target, wait)
      for (let share = FINE; upright.short > near && share <= 1 && !stooped(share); share += FINE);
      short = unreached()
      root.unwind?.()
      if (!short) aimed = this.solve(target, wait)
    } else short = unreached()
    if (short) return short
    // it sets off in time to turn at its ease, from how it will be then, for no longer than keeps its joints within how far they turn: twice round is near enough. Within a look of as soon as it can, it sets off then: and no sooner than the body spares it, a foot it stands on
    const { spare } = root
    let [easy, leaves] = [0, after]
    const spared = (from: number) => {
      if (spare && !this.held) while (from < wait && !spare(from, wait)) from += TICK
      return from
    }
    const sets = (swing: number, most: number) => {
      const to = drawn(aimed, swing, limb)
      const soonest = (leaves = direct ? after : spared(Math.max(after, wait - swing - most)))
      for (let k = 0; k < 2; k++) {
        const from = this.starts(leaves)
        const draws = (joint: 'first' | 'second') => longest(from[joint], to[joint], most, limb[joint].range)
        easy = swing + Math.min(draws('first'), draws('second'))
        if (!direct) leaves = spared(wait - easy < after + LOOK.fine ? after : Math.max(soonest, wait - easy))
      }
    }
    // as long as the limb sways: and before a fast arrival, that long to draw back as far as its joints turn, and then it swings
    let swing = fast ? this.swing(aimed, false) : 0
    sets(swing, sway(limb))
    // with less time than that it draws back in half of it, and only as far as it swings from at its ease
    if (fast && wait - leaves < easy - EXACT) sets((swing = this.swing(aimed, true)), sway(limb) / 2)
    if (!given && wait - after < easy - EXACT) {
      return miss(GOT.ease, easy - wait + after, `it has not had the ${easy.toFixed(2)} s it takes to get there`)
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

  /** where a target is `seconds` from now, as an error says it */
  protected spot(target: Target, seconds: number) {
    const places = this.where(target, seconds).toArray()
    return `(${places.map((n) => n.toFixed(2)).join(', ')})`
  }

  /** what to say of a joint that would have to be pushed too hard to turn as aimed in `seconds` */
  protected cannot({ joint, times }: { joint: Goal; times: number }, seconds: number, moving: boolean) {
    return `it cannot be where it is to be in the ${seconds.toFixed(2)} s it has${moving ? ', moving as it is to' : ''}: the ${joint.name} would have to be pushed ${times.toFixed(1)} times as hard as it can be`
  }
}
