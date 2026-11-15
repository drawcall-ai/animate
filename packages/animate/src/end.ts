import { Object3D, Vector3 } from 'three'
import { type State, quickest } from './curve'
import type { Held, Pose } from './fingers'
import { type Goal, MOST, timed } from './goal'
import { SLACK, sway } from './limb'
import { JOINTS, type Plan, Planner, drawn } from './planner'
import type { Aimed } from './reach'
import { type Arriving, type Reaching, type Target, moves } from './track'
import { EXACT, NUDGE, type Story, type Xyz, due, waits } from './world'

/** whether a target is to rest on a thing: kept to however the thing moves */
const keeps = (target: Target) => target.on instanceof Object3D && !moves(target)

/** What a story has of a hand: where its wrist is and how it moves, whether it is where it was sent, and to send it somewhere, have it somewhere by a moment, pose its fingers, or give it back to the body. */
export type Hand = Readonly<Pick<End, 'value' | 'velocity' | 'there' | 'to' | 'by' | 'shape' | 'free'>>
/** What a story has of a foot: where its ankle is and how it moves, where the ground holds it, if it does, and to send it somewhere, have it somewhere by a moment, or give it back to the body. */
export type Foot = Readonly<Pick<End, 'value' | 'velocity' | 'anchor' | 'free'>> & {
  to(place: Xyz, arriving?: Arriving & { seconds?: number }): Story<boolean>
  by(when: number, place: Xyz, arriving?: Arriving): Story<boolean>
}

/**
 * The far end of a limb: a foot or a hand. Sending it somewhere is one thing, however it is said: a place, in the
 * world, on him or on a thing, a velocity to arrive with, and a moment, given or the first there is. For that
 * a plan is made at once, and what has no plan is an error then. What it is sent to is carried out in the order it
 * was sent: it sets off for a later send no sooner than it has been where an earlier one sent it, and stays there
 * until then. On its way its joints are aimed anew every step, and a body that turns out not to bring it there, or
 * not moving as asked, is an error as soon as that shows. One that arrived moving is the body's again, and swings on
 * as one limb, its end going on across it, before it comes round to where the body wants it; one that arrived at rest
 * stays there until it is sent elsewhere or let `free`. A foot sent to rest on the ground is not planned: the body
 * steps there with it and stands over it. A hand sent somewhere turned arrives turned so, and stays so while it stays.
 * One sent to rest on a thing keeps to it however the thing moves, lagging behind it as it must: where it cannot be on
 * it, it lets go, and takes it again as soon as it can, unless the thing gives way to it.
 */
export class End extends Planner {
  /** where it is and how it is moving: the body tells, from where its limb has put it */
  readonly value = new Vector3()
  readonly velocity = new Vector3()
  /** where the ground holds it, if it does */
  anchor?: Vector3
  /** whether it is where it was last sent and stays there: arrived, and on a thing it was sent to, not let go of it */
  get there() {
    return this.plan?.there === true
  }

  /** what gives way to it, as it holds that or is on its way to */
  get gives() {
    return this.plan?.gives
  }

  /** the point of what gives way to it that rests in its shoulder, if one does */
  get rests() {
    return this.plan?.rests
  }

  /**
   * Sends the end to a place: one `on` him is counted from where its limb starts, the shoulder or the hip, and goes
   * with it. The velocity it arrives with is how it moves in the scene then, wherever the place is counted
   * from. Given `seconds`, it sets off at once and takes that long; otherwise it is there the first moment it can
   * be, having taken its time. The story it returns is over at that moment, or once a foot stands where it was sent
   * to step, and gives false if it was sent elsewhere before, or let go of the thing it was sent to on its way. A hand
   * can instead be sent to hold what it is on, or the scene or him, so: the place is then that thing as it is to sit in
   * the hand, which says how the hand is turned.
   */
  to(place: Xyz | Held, { seconds, ...arriving }: Reaching & { seconds?: number } = {}): Story<boolean> {
    timed(this.name, seconds)
    const target = this.target(place, arriving)
    const lands = this.kind === 'foot' && !target.on && target.place.y <= this.size.ankle && !moves(target)
    if (!lands) return this.send(target, seconds, true)
    if (seconds !== undefined) {
      throw new Error(`the ${this.name} is sent to step somewhere in ${seconds} s, and a step takes the time it takes`)
    }
    this.free()
    const put = this.put(target.place)
    return waits(
      () => this.mover.foot[this.side].put === put,
      () => (this.anchor?.distanceTo(target.place) ?? Infinity) < EXACT,
    )
  }

  /**
   * Has the end be at a place at a moment, on the clock of `update`: until it has to set off it goes on as it is.
   * The story it returns is over at that moment, and gives false if it was sent elsewhere before.
   */
  by(when: number, place: Xyz | Held, arriving: Reaching = {}): Story<boolean> {
    const soonest = this.clock + this.after
    if (!(when >= soonest)) {
      throw new Error(
        `the ${this.name} is to be somewhere by ${when.toFixed(2)} s, and it is ${when < this.clock ? `${this.clock.toFixed(2)} s now` : `kept where it was sent before until ${soonest.toFixed(2)} s`}: send it by then or later${when < this.clock ? '' : ', or free it first'}`,
      )
    }
    return this.send(this.target(place, arriving), when - this.clock, false)
  }

  /**
   * Has the fingers of a hand take a pose, or with none relax, and hold it until they are given another, whatever
   * else the hand does: in the time fingers take, or `by` a moment, setting off as late as they can for that. The story
   * it returns is over when they have it, and gives false if they were given another before.
   */
  shape(pose?: Pose, { by }: { by?: number } = {}): Story<boolean> {
    return this.fingers('are to take a pose').shape(pose, by === undefined ? undefined : by - this.clock)
  }

  /** Lets the end go: it is no longer on its way anywhere or kept at a place, and its limb is the body's again. */
  free() {
    for (const { stoop } of this.waiting.splice(0)) if (stoop) this.ahead.rise(stoop, this.clock)
    // with no fast arrival left to set off for, the rest of the body has none to swing into
    if (this.kind === 'hand') this.ahead.wind.off(this.side)
    // what the story does not have is the body's already
    if (this.held) this.release()
    this.claim()
    this.lift()
  }

  private lift() {
    if (this.kind === 'foot') this.put()
  }

  /** has the body step with the foot to a place on the ground and stand over it there: or with none, keep it there no longer. Tells where it is to stand so, if it is */
  private put(place?: Vector3) {
    const { mover, side } = this
    mover.put(side, place)
    this.ahead.stale()
    return mover.foot[side].put
  }

  /**
   * The story lets the limb go: it is the body's, and its joints swing out and come round to how the body wants them
   * in the time the limb sways there and back. Let go as it arrives moving, it goes on as one: it turns on about its
   * first joint as carries its end on across it, and folds no further.
   */
  private release() {
    const { plan } = this
    if (plan?.stoop) this.ahead.rise(plan.stoop, this.clock)
    const on = plan && moves(plan) && due(this.clock, plan.when) ? this.solve(plan, 0, true) : undefined
    this.plan = undefined
    this.loosen(on)
  }

  /** its joints swing out, turning `on` as they were to, and come round to how the body wants them */
  private loosen(on?: Aimed) {
    for (const joint of JOINTS) {
      const [part, turn] = [this.limb[joint], on?.[joint]]
      if (turn) part?.velocity.copy(turn.velocity)
      part?.release(sway(this.limb))
    }
  }

  /**
   * Makes the plan for a target and has the end wait to set off for it, after what it was sent to before: for
   * `seconds` from now, setting off at once if it is to be `direct`, or for the first moment that has a plan.
   */
  private send(target: Target, seconds: number | undefined, direct: boolean): Story<boolean> {
    // what he is down for where it was sent before he will be down for only until it sets off: as soon as it can, as far as is known yet
    const stoops = this.sent.flatMap((plan) => plan.stoop ?? [])
    const untils = stoops.map(({ until }) => until)
    for (const stoop of stoops) this.ahead.rise(stoop, Math.min(stoop.until, this.clock + this.after))
    const wait = direct && seconds !== undefined ? this.after + seconds : seconds
    const found = wait === undefined ? this.scan(target, false) : this.fit(target, wait, { given: true, direct })
    if ('say' in found && !(keeps(target) && wait === undefined)) throw new Error(found.say)
    const after = this.clock + this.after
    const plan = 'say' in found ? { ...target, when: after, leaves: after, swing: 0 } : found
    if ('say' in found) this.claim(plan)
    stoops.forEach((stoop, k) => this.ahead.rise(stoop, Math.min(untils[k], plan.leaves)))
    this.waiting.push(plan)
    return waits(
      () => this.sent.includes(plan) && plan.there !== false,
      () => plan.there === true,
    )
  }

  /**
   * At its moment it is where it was sent, moving as it was to, or that is an error. What arrived moving is let go,
   * to swing out: and a foot that stays somewhere in the air, as he comes down, for the ground. A thing moves only
   * between updates: the first step of one is told it is, a `frame`, and what the end is on or sent to is looked at
   * anew.
   */
  arrive(frame: boolean) {
    const thing = this.sent.map(({ on }) => on).find((on) => on instanceof Object3D)
    if (frame && thing) this.see(thing)
    const { plan } = this
    if (!plan || !due(this.clock, plan.when)) return
    if (plan.there === undefined) this.check(plan)
    const lands = this.kind === 'foot' && this.mover.falls && this.mover.velocity.y <= 0
    if (!moves(plan) && !(this.waiting.length === 0 && lands)) return
    this.release()
    this.claim()
  }

  private check(plan: Plan) {
    // (sent with a part of the hand, it is that which is to be there)
    const at = this.tipped(plan, 0, this.value.clone())
    const next = this.tipped(plan, NUDGE, this.value.clone().addScaledVector(this.velocity, NUDGE))
    const [off, slow] = [at.distanceTo(this.where(plan, 0)), next.sub(at).divideScalar(NUDGE).distanceTo(plan.velocity)]
    const far = off >= SLACK.place * this.size.leg || (moves(plan) && slow > SLACK.speed * plan.velocity.length())
    // (on a thing it may lag behind it: it is there once it has caught up)
    if (far && keeps(plan)) return
    if (far) {
      throw new Error(
        `the ${this.name} was to be ${this.spot(plan, 0)} now, moving at ${plan.velocity.length().toFixed(1)} m/s, and is ${off.toFixed(2)} m from there and ${slow.toFixed(1)} m/s off that: he was not where he was going to be while it was on its way. Send it after what changes the way he goes`,
      )
    }
    plan.there = true
  }

  /**
   * Before a step of time from `now`: what is next to set off does, if it is time; and the joints are aimed at
   * where the end is going, or staying. Tells of the thing it has lost hold of in this step, if it has.
   */
  advance(now: number, dt: number) {
    this.clock = now + dt
    const next = this.waiting[0]
    if (next && due(now, next.leaves)) this.leave(next, next.when - now)
    const going = this.plan
    if (!going) return []
    // staying, it is kept where it was sent as the rest of the body moves
    const seconds = Math.max(going.when - now, dt)
    const aimed = keeps(going) ? this.solve(going, seconds) : this.aim(going, seconds)
    // (what gives way to it it never lets go of: the limb is turned to it the way nearest how it is turned, and aimed at
    // it at rest, as it is told where it is but not how it moves)
    if (going.gives) {
      aimed.first.value.copy(this.within(this.limb.first, aimed.first.value, true))
      for (const joint of JOINTS) aimed[joint]?.velocity.set(0, 0, 0)
    } else if (keeps(going)) {
      // (judged where the thing is now: let go of, it is taken again only once its limb reaches it by as much again.
      // What it never had it lets go of untold: the story sent it there is told so)
      const [at, slack, was] = [this.solve(going, 0), SLACK.reach * this.size.leg, going.there]
      const stuck = this.stuck({ first: at.first, second: at.second })
      const how = this.slips(going, at, was === false ? -slack : slack, stuck)
      if (how || was === false) going.there = !how
      if (how && was !== false) this.loosen()
      const lost =
        how &&
        was &&
        `the ${this.name} is to be on a thing at ${this.spot(going, 0)}, and ${how}. It lets go of it, and takes it again as soon as it can`
      if (how) return lost ? [new Error(lost)] : []
    }
    const back = drawn(aimed, going.swing, this.limb)
    // on a thing, or on its way to it, it goes after it no harder than its joints can be pushed, and lags if it must
    const takes = (joint: Goal, to: State, most: number) =>
      keeps(going) ? Math.max(most, quickest(joint, to, (MOST + SLACK.push) * joint.strength, joint.range)) : most
    for (const joint of JOINTS) {
      const [part, drawn, turn] = [this.limb[joint], back[joint], aimed[joint]]
      if (!part || !drawn || !turn) continue
      // with longer than a joint swings for, it draws back first to where it swings from
      const draws = seconds > drawn.swing
      const to = draws ? drawn : turn
      part.drive(to, takes(part, to, draws ? seconds - drawn.swing : seconds))
    }
    return []
  }

  /** what keeps a limb turned so from where a plan has it, if something does: being further short than `slack`, or `stuck` */
  private slips(plan: Plan, { short }: Aimed, slack: number, stuck?: string | false) {
    const keep = plan.on ? 'the thing' : 'the body'
    if (short > slack) return `its limb is ${short.toFixed(2)} m short of there: keep ${keep} where its limb reaches`
    return stuck ? `as the body is going, ${stuck}` : undefined
  }

  /** it sets off: the limb is the story's from now on. A plan asks for no more than the limb is strong enough for, as he was looked ahead to be: he is not quite */
  private leave(plan: Plan, seconds: number) {
    const { first, second } = this.limb
    // a leg the body has stepped with goes on as the body had it turning at the moment it was to set off: over the last step of time it may just have come straight
    const strode = this.strides(seconds - plan.when + plan.leaves)
    if (strode) [first.velocity.x, second.velocity.x] = [strode.first.velocity.x, strode.second.velocity.x]
    // (one for a thing goes no harder than it can, and is late if it must)
    const takes = keeps(plan) ? undefined : this.pushed(this.aim(plan, seconds), seconds, plan.swing)
    if (takes && takes.times > MOST + SLACK.push) {
      throw new Error(
        `the ${this.name} sets off for ${this.spot(plan, seconds)}, and now ${this.cannot(takes, seconds, moves(plan))}: he is not where he was going to be when it was sent. Send it after what changes the way he goes, or ask less of it`,
      )
    }
    this.waiting.shift()
    this.plan = plan
    this.anchor = undefined
    this.lift()
  }

  /** works out how the joints must be for a plan, `seconds` from now as the body is going: an error if it no longer brings the limb there, and staying there it is let free */
  private aim(plan: Plan, seconds: number) {
    const aimed = this.solve(plan, seconds)
    const how = this.slips(plan, aimed, SLACK.reach * this.size.leg, aimed.stuck)
    if (!how) return aimed
    // (setting off, it has nowhere it stays yet: only one that stays can be kept too long for what it is sent to next.
    // What can stay no longer is let go, for the rest of him to go on)
    const help =
      plan !== this.plan
        ? `. He is not where he was going to be when it was sent: send it after what changes the way he goes`
        : this.waiting.length
          ? `. It sets off too late for where it is sent next: give that \`seconds\`, or state it sooner`
          : `. It is let free`
    throw new Error(
      `the ${this.name} is to be ${plan.on ? 'on a thing at ' : ''}${this.spot(plan, seconds)}, and ${how}${help}`,
    )
  }
}
