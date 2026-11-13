import { Vector3 } from 'three'
import { MOST, REST, timed } from './goal'
import { SLACK } from './limb'
import { type Plan, Planner, type Target, drawn, moves, sway } from './plan'
import { type Story, type Xyz, due } from './world'

/** how an end is to arrive: moving so, and at a place `carried` with the body or not */
type Arriving = { velocity?: Xyz; carried?: boolean }

/** What a story has of a hand: where it is and how it moves, and to send it somewhere, have it somewhere by a moment, or give it back to the body. */
export type Hand = Readonly<Pick<End, 'value' | 'velocity' | 'to' | 'by' | 'free'>>
/** What a story has of a foot: what it has of a hand, and where the ground holds it, if it does. */
export type Foot = Hand & Readonly<Pick<End, 'anchor'>>

/**
 * The far end of a limb: a foot or a hand. Sending it somewhere is one thing, however it is said: a place, in the
 * world or `carried` with the body, a velocity to arrive with, and a moment, given or the first there is. For that
 * a plan is made at once, and what has no plan is an error then. What it is sent to is carried out in the order it
 * was sent: it sets off for a later send no sooner than it has been where an earlier one sent it, and stays there
 * until then. On its way its joints are aimed anew every step, and a body that turns out not to bring it there, or
 * not moving as asked, is an error as soon as that shows. One that arrived moving is the body's again, and swings on
 * as one limb, its end going on across it, before it comes round to where the body wants it; one that arrived at rest
 * stays there until it is sent elsewhere or let `free`. A foot sent to rest on the ground is not planned: the body
 * steps there with it and stands over it.
 */
export class End extends Planner {
  /** where it is and how it is moving: the body tells, from where its limb has put it */
  readonly value = new Vector3()
  readonly velocity = new Vector3()
  /** where the ground holds it, if it does */
  anchor?: Vector3
  /** where the story has put it on the ground, a foot */
  private put?: Vector3
  /**
   * Sends the end to a place: a `carried` place is counted from where its limb starts, the shoulder or the hip, and
   * goes with it. The velocity it arrives with is how it moves in the scene then, wherever the place is counted
   * from. Given `seconds`, it sets off at once and takes that long; otherwise it is there the first moment it can
   * be, having taken its time. The story it returns is over at that moment, or once a foot stands where it was sent
   * to step, and gives false if it was sent elsewhere before.
   */
  to(place: Xyz, { velocity = REST, seconds, carried = false }: Arriving & { seconds?: number } = {}): Story<boolean> {
    timed(this.name, seconds)
    const target = this.target(place, velocity, carried)
    const { ground } = this
    const lands = ground !== undefined && !carried && target.place.y <= ground && !moves(target)
    if (!lands) return this.send(target, seconds, true)
    // a foot sent to rest on the ground makes a step there: the body's, which then stands over it
    if (seconds !== undefined) {
      throw new Error(`the ${this.name} is sent to step somewhere in ${seconds} s, and a step takes the time it takes`)
    }
    this.free()
    this.root.put?.((this.put = target.place))
    return this.stepped(target.place)
  }

  /**
   * Has the end be at a place at a moment, on the clock of `update`: until it has to set off it goes on as it is.
   * The story it returns is over at that moment, and gives false if it was sent elsewhere before.
   */
  by(when: number, place: Xyz, { velocity = REST, carried = false }: Arriving = {}): Story<boolean> {
    const soonest = this.clock + this.after
    if (!(when >= soonest)) {
      throw new Error(
        `the ${this.name} is to be somewhere by ${when.toFixed(2)} s, and that is before ${soonest.toFixed(2)} s: now, or the moment it is where it was sent before`,
      )
    }
    return this.send(this.target(place, velocity, carried), when - this.clock, false)
  }

  /** what is asked for, if it can be asked: numbers, above the ground a foot stands on, and a carried place no further from where the limb starts than the limb is long */
  private target(at: Xyz, moving: Xyz, carried: boolean): Target {
    const [place, velocity] = [new Vector3().copy(at), new Vector3().copy(moving)]
    if (![...place.toArray(), ...velocity.toArray()].every(Number.isFinite)) {
      throw new Error(`the ${this.name} is sent to a place, or to move there, as no numbers say`)
    }
    if (this.ground !== undefined && !carried && place.y < this.ground - 1e-9) {
      throw new Error(
        `the ${this.name} is sent to ${place.y.toFixed(2)} m up, and stands on the ground at ${this.ground.toFixed(2)}`,
      )
    }
    if (carried && place.length() > this.limb.length) {
      throw new Error(
        `the ${this.name} is to be carried ${place.length().toFixed(2)} m from where its limb starts, and the limb is ${this.limb.length.toFixed(2)} m long`,
      )
    }
    return { place, velocity, carried }
  }

  /** Lets the end go: it is no longer on its way anywhere or kept at a place, and its limb is the body's again. */
  free() {
    for (const { stoop } of this.waiting.splice(0)) if (stoop) this.root.rise(stoop, this.clock)
    // with no fast arrival left to set off for, the rest of the body has none to swing into
    this.root.unwind?.()
    // what the story does not have is the body's already
    if (this.held) this.release()
    this.claim()
    this.lift()
  }

  /** where it was to stay on the ground it stays no longer */
  private lift() {
    this.root.put?.()
    this.put = undefined
  }

  /**
   * The story lets the limb go: it is the body's, and its joints swing out and come round to how the body wants them
   * in the time the limb sways there and back. Let go as it arrives moving, it goes on as one: it turns on about its
   * first joint as carries its end on across it, and folds no further.
   */
  private release() {
    const { plan, limb } = this
    if (plan?.stoop) this.root.rise(plan.stoop, this.clock)
    if (plan && moves(plan) && due(this.clock, plan.when)) {
      const on = this.solve(plan, 0, true)
      limb.first.velocity.copy(on.first.velocity)
      limb.second.velocity.copy(on.second.velocity)
    }
    this.plan = undefined
    limb.first.release(sway(limb))
    limb.second.release(sway(limb))
  }

  /**
   * Makes the plan for a target and has the end wait to set off for it, after what it was sent to before: for
   * `seconds` from now, setting off at once if it is to be `direct`, or for the first moment that has a plan.
   */
  private send(target: Target, seconds: number | undefined, direct: boolean): Story<boolean> {
    // what he is down for where it was sent before he will be down for only until it sets off: as soon as it can, as far as is known yet
    const stoops = this.sent.flatMap((plan) => plan.stoop ?? [])
    const untils = stoops.map(({ until }) => until)
    for (const stoop of stoops) this.root.rise(stoop, Math.min(stoop.until, this.clock + this.after))
    const wait = direct && seconds !== undefined ? this.after + seconds : seconds
    const plan = wait === undefined ? this.scan(target, false) : this.fit(target, wait, { given: true, direct })
    if ('say' in plan) throw new Error(plan.say)
    stoops.forEach((stoop, k) => this.root.rise(stoop, Math.min(untils[k], plan.leaves)))
    this.waiting.push(plan)
    return this.arrival(plan)
  }

  /** a story that is over at a plan's moment, or when the end is sent elsewhere: and tells whether it was there then */
  private *arrival(plan: Plan): Story<boolean> {
    while ((this.plan === plan || this.waiting.includes(plan)) && !due(this.clock, plan.when)) yield
    return plan.there ?? false
  }

  /** a story that is over once the foot stands where the story put it, or it was sent elsewhere: and tells which */
  private *stepped(place: Vector3): Story<boolean> {
    while (this.put === place && !this.anchor?.equals(place)) yield
    return this.put === place
  }

  /** at its moment it is where it was sent, moving as it was to, or that is an error: and what arrived moving is let go, to swing out */
  arrive() {
    const { plan } = this
    if (!plan || plan.there !== undefined || !due(this.clock, plan.when)) return
    const off = this.value.distanceTo(this.where(plan, 0))
    const slow = this.velocity.distanceTo(plan.velocity)
    if (off >= SLACK.place || (moves(plan) && slow > SLACK.speed * plan.velocity.length())) {
      throw new Error(
        `the ${this.name} was to be ${this.spot(plan, 0)} now, moving at ${plan.velocity.length().toFixed(1)} m/s, and is ${off.toFixed(2)} m from there and ${slow.toFixed(1)} m/s off that: he was not where he was going to be while it was on its way. Send it after what changes the way he goes`,
      )
    }
    plan.there = true
    if (!moves(plan)) return
    this.release()
    this.claim()
  }

  /**
   * Before a step of time from `now`: what is next to set off does, if it is time; and the joints are aimed at
   * where the end is going, or staying.
   */
  advance(now: number, dt: number) {
    this.clock = now + dt
    const next = this.waiting[0]
    if (next && due(now, next.leaves)) this.leave(next, next.when - now)
    const going = this.plan
    if (!going) return
    // staying, it is kept where it was sent as the rest of the body moves
    const seconds = Math.max(going.when - now, dt)
    const aimed = this.aim(going, seconds)
    const back = drawn(aimed, going.swing, this.limb)
    for (const joint of ['first', 'second'] as const) {
      // with longer than a joint swings for, it draws back first to where it swings from
      const draws = seconds > back[joint].swing
      this.limb[joint].drive(draws ? back[joint] : aimed[joint], draws ? seconds - back[joint].swing : seconds)
    }
  }

  /** it sets off: the limb is the story's from now on. A plan asks for no more than the limb is strong enough for, as he was looked ahead to be: he is not quite */
  private leave(plan: Plan, seconds: number) {
    const { first, second } = this.limb
    // a leg the body has stepped with goes on as the body had it turning at the moment it was to set off: over the last step of time it may just have come straight
    const led = this.led(seconds - plan.when + plan.leaves)
    if (led) [first.velocity.x, second.velocity.x] = [led.first.velocity.x, led.second.velocity.x]
    const takes = this.pushed(this.aim(plan, seconds), seconds, plan.swing)
    if (takes.times > MOST + SLACK.push) {
      throw new Error(
        `the ${this.name} sets off for ${this.spot(plan, seconds)}, and now ${this.cannot(takes, seconds, moves(plan))}: he is not where he was going to be when it was sent. Send it after what changes the way he goes, or ask less of it`,
      )
    }
    this.waiting.shift()
    this.plan = plan
    this.anchor = undefined
    this.lift()
  }

  /** works out how the joints must be for a plan, `seconds` from now as the body is going: an error if it no longer brings the limb there */
  private aim(plan: Plan, seconds: number) {
    const aimed = this.solve(plan, seconds)
    const help = this.waiting.length
      ? `it sets off too late for where it is sent next. Give that \`seconds\`, or state it sooner, and it leaves in time`
      : `let the ${this.name} free first, or keep the body where its limb reaches`
    const out = `the body is taking its limb ${aimed.short.toFixed(2)} m out of reach of there`
    const how = aimed.short > SLACK.reach ? out : aimed.stuck && `as the body is going ${aimed.stuck}`
    if (how) throw new Error(`the ${this.name} is to be ${this.spot(plan, seconds)}, and ${how}: ${help}`)
    return aimed
  }
}
