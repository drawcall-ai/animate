import { Euler, Quaternion, Vector3 } from 'three'
import { AXES, type State, between, longest } from './curve'
import { EASY, type Goal, MOST, REST } from './goal'
import { type Limb, sway } from './limb'
import { type Aimed, FULL, Reach, type Turn } from './reach'
import { tick } from './size'
import { type Stoop, lower } from './stoops'
import { type Target, moves } from './track'
import { EXACT, NUDGE, clamp, steps } from './world'

/**
 * how an end gets to a target: the moment it is there, the moment it sets off, how long it swings into a fast arrival,
 * drawn back first (s), what the body gets down for it, and whether it was there at its moment once that has come: on
 * a thing, false while it has let go of it
 */
export type Plan = Target & { when: number; leaves: number; swing: number; stoop?: Stoop; there?: boolean }
/** the joints of a limb from its first out, the last at the wrist of a hand */
export const JOINTS = ['first', 'second', 'wrist'] as const
type Turning = { first: State; second: State; wrist?: State }
/** how a joint is drawn back, and how long it swings from there (s) */
type Drawn = State & { value: Vector3; swing: number }
/** why there is no plan for a moment: how far the planning got, by how much it fell short, and what to say of it */
type Miss = { rank: number; by: number; say: string }
/** how far the planning gets with a moment: the limb reaches, its joints turn that far, it has had the time to swing at its ease, the body spares it, and its joints are strong enough */
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
const turned = new Quaternion()
const to = new Vector3()
const rotation = new Euler()

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
    // (no further than its range, nor than where it is to be turned, at the end of that range already)
    const at = (axis: (typeof AXES)[number]) => {
      const [least, most] = joint.range[axis] ?? [-Infinity, Infinity]
      const to = turn.value[axis]
      return clamp(to - (turn.velocity[axis] * late) / 2, Math.min(least, to), Math.max(most, to))
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

const missed = (found: Plan | Miss): found is Miss => 'say' in found

/**
 * How the far end of a limb gets to where it is sent. A plan is made looking ahead along the way the body is going:
 * where the limb will start from then, how far the body has to get down for it to reach, when the body spares it, and
 * how long its joints take, each on its own smoothest way. With time to spare it sets off in time to turn at its ease,
 * as long as the limb sways under its own weight: before a fast arrival it first draws back so, as one limb about its
 * first joint, as far as its joints turn clear of the trunk, and swings from there. With less, it draws back only as
 * far as speeding up at its ease takes; with little, it sets off as late as the body spares it, and swings in one,
 * drawing back on its way.
 */
export class Planner extends Reach {
  /** the plan it is carrying out: on its way, or staying where it came to rest */
  protected plan?: Plan
  /** the plans it has still to set off for, in the order they were sent: until one does, it goes on as it is */
  protected readonly waiting: Plan[] = []
  protected clock = 0

  /** whether the story has its limb: it has set off for somewhere, and has not arrived moving or been let `free` since */
  get held() {
    return this.plan !== undefined
  }

  protected get sent() {
    return this.plan ? [this.plan, ...this.waiting] : this.waiting
  }

  /** where the end is to be `seconds` from now, and the nearest place to that where the limb can have it, or has it, `held` after a step: see `closest` */
  nearest(seconds: number, held = false) {
    const { plan } = this
    if (!plan) throw new Error(`the ${this.name} is asked how near it comes to where it is sent, and is sent nowhere`)
    return this.closest(plan, seconds, held)
  }

  /** how soon it can set off for what it is sent to next (s from now): at the moment of what it was sent to last, and no sooner */
  protected get after() {
    return Math.max(0, (this.sent.at(-1)?.when ?? 0) - this.clock)
  }

  /** the body is told from when until when the story has the end: for all it is sent to, and a `plan` that is being made */
  protected claim(plan?: Plan) {
    const plans = plan ? [...this.sent, plan] : this.sent
    const [from, last] = [plans[0]?.leaves, plans.at(-1)]
    if (this.kind !== 'foot') return
    // (it sets off after the step of time it is told to at)
    const until = last && moves(last) ? last.when : Infinity
    this.mover.foot[this.side].taken = from === undefined ? undefined : { from: from + tick(this.size), until }
    this.ahead.stale()
  }

  /** how the body that steps with the end will have the joints turned and turning `seconds` from now: if it is the body's to step with */
  protected strides(seconds: number): Turning | undefined {
    const { ahead, side } = this
    if (this.kind !== 'foot' || this.held) return undefined
    const place = ahead.stepped(side, seconds, new Vector3())
    const dt = tick(this.size)
    const velocity = ahead
      .stepped(side, seconds + dt, new Vector3())
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
    if (!last) return this.strides(seconds) ?? this.limb
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
   * first of all: with the body getting down for it if it `stoops`, which is looked for only once no moment has a plan
   * otherwise, and what that misses is what is told.
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
    return stoops ? (reached ?? missing) : this.scan(target, true)
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
    const { ahead, limb, after, kind, side } = this
    const [margin, dt] = [MARGIN * this.size.leg, tick(this.size)]
    // (a moment is a step of his time: the first at or after what is asked)
    const wait = steps(asked, dt) * dt
    const when = this.clock + wait
    const fast = moves(target)
    const until = fast ? when : Infinity
    // the rest of the body winds up for a fast arrival: which changes where he is going
    const wind = (leaves: number) =>
      fast && kind === 'hand' && ahead.wind.up(side, leaves, when, this.where(target, wait), target.velocity)
    let upright = this.solve(target, wait)
    let aimed = upright
    let stoop: Stoop | undefined
    const stooped = (share: number) => {
      if (stoop) ahead.rise(stoop, -Infinity)
      stoop = lower(kind, side, this.mover, ahead, [share, when, until], this.where(target, wait), limb.length)
      wind(when)
      aimed = this.solve(target, wait)
      return aimed.short <= -margin
    }
    let plan: Plan | undefined
    const miss = (rank: number, by: number, say: string): Miss => {
      if (stoop) ahead.rise(stoop, -Infinity)
      if (kind === 'hand') ahead.wind.off(side)
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
      if (kind === 'hand') ahead.wind.off(side)
      if (!short) aimed = this.solve(target, wait)
    } else short = unreached()
    if (short) return short
    // it sets off in time to turn at its ease, from how it will be then, for no longer than keeps its joints within how far they turn: twice round is near enough. Within a look of as soon as it can, it sets off then: and no sooner than the body spares it, a foot it stands on
    let [easy, leaves] = [0, after]
    const spared = (from: number) => {
      if (kind === 'foot' && !this.held) while (from < wait && !ahead.spare(side, from, wait)) from += dt
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
      const slowed = (by: number) => ({ ...target, velocity: target.velocity.clone().multiplyScalar(by) })
      const strong = (by: number) => this.pushed(this.solve(slowed(by), wait), wait - leaves, swing, from).times <= MOST
      const share = fast && given ? between(0, 1, strong)[0] : 0
      const speed = share > 0 ? `at ${(share * target.velocity.length()).toFixed(1)} m/s or slower` : 'slower'
      const less = fast
        ? `it to arrive ${speed}, or moving more across its limb: a limb swings its end across itself far faster than it stretches`
        : 'a place nearer where it is'
      const help = `${given ? 'Give it longer, or ask' : 'Ask'} for ${less}`
      return miss(GOT.strength, takes.times, `${this.cannot(takes, wait - leaves, fast)}. ${help}`)
    }
    return plan
  }

  protected cannot({ joint, times }: { joint: Goal; times: number }, seconds: number, moving: boolean) {
    return `it cannot be where it is to be in the ${seconds.toFixed(2)} s it has${moving ? ', moving as it is to' : ''}: the ${joint.name} would have to be pushed ${times.toFixed(1)} times as hard as it can be`
  }
}
