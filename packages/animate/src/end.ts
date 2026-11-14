import { Object3D, Quaternion, Vector3 } from 'three'
import type { Body } from './body'
import { type State, quickest } from './curve'
import { type Goal, MOST, REST, timed } from './goal'
import { DOWN, FINGERS, type Held, type Pose, type Touch } from './hand'
import { SLACK } from './limb'
import { type Aimed, JOINTS, type Plan, Planner, type Target, drawn, moves, sway } from './plan'
import { EXACT, NUDGE, type Story, type Xyz, due, waits } from './world'

/**
 * how an end is to arrive: moving so, in the scene, and at a place counted `on` him, from where its limb starts and as
 * he faces, or on a thing, in its frame as it moves; or in the scene
 */
type Arriving = { velocity?: Xyz; on?: Object3D | Body }
/**
 * and a hand: turned for its `palm` to face and for the fingers, or what it carries, to be `pointing` a way, counted
 * as its place is; the place being that of what it is there `with`, if not its wrist
 */
type Reaching = Arriving & { palm?: Xyz; pointing?: Xyz; with?: Touch }

/** What a story has of a hand: where its wrist is and how it moves, and to send it somewhere, have it somewhere by a moment, pose its fingers, or give it back to the body. */
export type Hand = Readonly<Pick<End, 'value' | 'velocity' | 'to' | 'by' | 'shape' | 'free'>>
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
 */
export class End extends Planner {
  /** where it is and how it is moving: the body tells, from where its limb has put it */
  readonly value = new Vector3()
  readonly velocity = new Vector3()
  /** where the ground holds it, if it does */
  anchor?: Vector3
  /**
   * Sends the end to a place: one `on` him is counted from where its limb starts, the shoulder or the hip, and goes
   * with it. The velocity it arrives with is how it moves in the scene then, wherever the place is counted
   * from. Given `seconds`, it sets off at once and takes that long; otherwise it is there the first moment it can
   * be, having taken its time. The story it returns is over at that moment, or once a foot stands where it was sent
   * to step, and gives false if it was sent elsewhere before. A hand can instead be sent to hold what it is on, or the
   * scene or him, so: the place is then that thing as it is to sit in the hand, which says how the hand is turned.
   */
  to(place: Xyz | Held, { seconds, ...arriving }: Reaching & { seconds?: number } = {}): Story<boolean> {
    timed(this.name, seconds)
    const target = this.target(place, arriving)
    const { ground, root } = this
    const lands = root.leg && ground !== undefined && !target.on && target.place.y <= ground && !moves(target)
    if (!lands) return this.send(target, seconds, true)
    if (seconds !== undefined) {
      throw new Error(`the ${this.name} is sent to step somewhere in ${seconds} s, and a step takes the time it takes`)
    }
    this.free()
    const put = root.put(target.place)
    return waits(
      () => root.placed() === put,
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

  private fingers(asked: string) {
    const fingers = this.limb.hand?.fingers
    if (fingers) return fingers
    throw new Error(`the fingers of the ${this.name} ${asked}, and its rig has no finger bones`)
  }

  private target(at: Xyz | Held, { velocity: moving = REST, on: told, palm, pointing, with: touch }: Reaching): Target {
    const on = told === this.rig.body ? 'him' : told
    if (on !== undefined && on !== 'him' && !(on instanceof Object3D)) {
      throw new Error(`the ${this.name} is sent to a place on something that is neither him nor a thing`)
    }
    if (on instanceof Object3D) this.see(on)
    if ('quaternion' in at && (palm || pointing || touch)) {
      throw new Error(
        `the ${this.name} is sent to hold something, which says where it is and how it is turned: leave out \`palm\`, \`pointing\` and \`with\``,
      )
    }
    const holding = 'quaternion' in at ? this.holding(at, on) : { place: new Vector3().copy(at), palm, pointing }
    const [place, velocity] = [holding.place, new Vector3().copy(moving)]
    const ways = [holding.palm, holding.pointing].map((way) => way && new Vector3().copy(way))
    const [faces, points] = ways.map((way) => way?.normalize())
    const across = faces && points ? faces.clone().cross(points).lengthSq() : 1
    const carried = typeof touch === 'object' ? this.framed(touch) : undefined
    const numbers = [place, velocity, ...ways, carried?.at, carried?.along]
    if (!numbers.every((one) => !one || one.toArray().every(Number.isFinite))) {
      throw new Error(`the ${this.name} is sent to a place, to move there, or turned a way, as no numbers say`)
    }
    if (ways.some((way) => way?.lengthSq() === 0) || across < EXACT) {
      throw new Error(
        `the ${this.name} is turned a way that leads nowhere, or to point the way its palm faces: the palm is kept, and the fingers point as near where they are to as is square to it`,
      )
    }
    if (this.ground !== undefined && !on && place.y < this.ground - 1e-9) {
      throw new Error(
        `the ${this.name} is sent to ${place.y.toFixed(2)} m up, and stands on the ground at ${this.ground.toFixed(2)}`,
      )
    }
    if (on === 'him' && place.length() > this.limb.length) {
      throw new Error(
        `the ${this.name} is to be ${place.length().toFixed(2)} m from where its limb starts, and the limb is ${this.limb.length.toFixed(2)} m long`,
      )
    }
    if (typeof touch === 'string' && ![...FINGERS, 'palm'].includes(touch)) {
      throw new Error(
        `the ${this.name} is sent to be somewhere with its ${touch}, and that is the tip of the ${FINGERS.join(', ')}, the palm, or a thing as it sits in the hand`,
      )
    }
    if (typeof touch === 'string') this.fingers(`are to have the hand somewhere with its ${touch}`)
    const along = carried?.along
    return {
      place,
      velocity,
      on,
      palm: faces,
      pointing: points,
      along,
      with: typeof touch === 'object' ? carried?.at : touch,
    }
  }

  /** a thing as it sits in the hand: where it is from the wrist and the way its z goes, in the frame of the hand as it hangs */
  private framed({ position, quaternion }: Held) {
    const { hangs, large } = this.rig
    const turned = new Quaternion().copy(quaternion).premultiply(hangs)
    const at = new Vector3().copy(position).multiplyScalar(large).applyQuaternion(hangs)
    return { at, turned, along: new Vector3(0, 0, 1).applyQuaternion(turned) }
  }

  /**
   * where the wrist is and how the hand is turned, for what a place is counted on, a thing or the frame of the scene
   * or of him, to sit in the hand so: in that frame, and in its lengths
   */
  private holding(held: Held, on?: 'him' | Object3D) {
    const { at, turned } = this.framed(held)
    const hand = this.limb.hand
    if (!hand) throw new Error(`the ${this.name} is sent to hold something, and is no hand`)
    // (a thing's lengths against the body's)
    if (on instanceof Object3D) on.updateWorldMatrix(true, false)
    const large = on instanceof Object3D ? on.getWorldScale(new Vector3()).x * this.rig.frame.getMaxScaleOnAxis() : 1
    const back = turned.clone().invert()
    return {
      place: at.negate().applyQuaternion(back).divideScalar(large),
      palm: hand.palm.clone().applyQuaternion(back),
      pointing: DOWN.clone().applyQuaternion(back),
    }
  }

  /** Lets the end go: it is no longer on its way anywhere or kept at a place, and its limb is the body's again. */
  free() {
    for (const { stoop } of this.waiting.splice(0)) if (stoop) this.ahead.rise(stoop, this.clock)
    // with no fast arrival left to set off for, the rest of the body has none to swing into
    if (!this.root.leg) this.root.unwind()
    // what the story does not have is the body's already
    if (this.held) this.release()
    this.claim()
    this.lift()
  }

  private lift() {
    if (this.root.leg) this.root.put()
  }

  /**
   * The story lets the limb go: it is the body's, and its joints swing out and come round to how the body wants them
   * in the time the limb sways there and back. Let go as it arrives moving, it goes on as one: it turns on about its
   * first joint as carries its end on across it, and folds no further.
   */
  private release() {
    const { plan, limb } = this
    if (plan?.stoop) this.ahead.rise(plan.stoop, this.clock)
    const on = plan && moves(plan) && due(this.clock, plan.when) ? this.solve(plan, 0, true) : undefined
    this.plan = undefined
    for (const joint of JOINTS) {
      const [part, turn] = [limb[joint], on?.[joint]]
      if (turn) part?.velocity.copy(turn.velocity)
      part?.release(sway(limb))
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
    const plan = wait === undefined ? this.scan(target, false) : this.fit(target, wait, { given: true, direct })
    if ('say' in plan) throw new Error(plan.say)
    stoops.forEach((stoop, k) => this.ahead.rise(stoop, Math.min(untils[k], plan.leaves)))
    this.waiting.push(plan)
    return waits(
      () => this.sent.includes(plan),
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
    if (!moves(plan) && !(this.waiting.length === 0 && this.root.leg && this.root.lands())) return
    this.release()
    this.claim()
  }

  private check(plan: Plan) {
    // (sent with a part of the hand, it is that which is to be there)
    const at = this.tipped(plan, 0, this.value.clone())
    const next = this.tipped(plan, NUDGE, this.value.clone().addScaledVector(this.velocity, NUDGE))
    const [off, slow] = [at.distanceTo(this.where(plan, 0)), next.sub(at).divideScalar(NUDGE).distanceTo(plan.velocity)]
    if (off >= SLACK.place * this.size.leg || (moves(plan) && slow > SLACK.speed * plan.velocity.length())) {
      throw new Error(
        `the ${this.name} was to be ${this.spot(plan, 0)} now, moving at ${plan.velocity.length().toFixed(1)} m/s, and is ${off.toFixed(2)} m from there and ${slow.toFixed(1)} m/s off that: he was not where he was going to be while it was on its way. Send it after what changes the way he goes`,
      )
    }
    plan.there = true
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
    // on a thing, it follows it as hard as its joints can be pushed: one that leaves it further behind than that has
    // outrun it
    const follows = going.there && going.on instanceof Object3D
    if (follows) this.follows(aimed)
    const takes = (joint: Goal, to: State, most: number) =>
      follows ? Math.max(most, quickest(joint, to, (MOST + SLACK.push) * joint.strength, joint.range)) : most
    for (const joint of JOINTS) {
      const [part, drawn, turn] = [this.limb[joint], back[joint], aimed[joint]]
      if (!part || !drawn || !turn) continue
      // with longer than a joint swings for, it draws back first to where it swings from
      const draws = seconds > drawn.swing
      const to = draws ? drawn : turn
      part.drive(to, takes(part, to, draws ? seconds - drawn.swing : seconds))
    }
  }

  /** an end that follows a thing is no further behind where it has the thing than a plan may be off, or that is an error */
  private follows({ first, second }: Aimed) {
    const { limb, plan } = this
    const off = limb.at(limb.first.value, limb.second.value.x).distanceTo(limb.at(first.value, second.value.x))
    if (!plan || off <= SLACK.place * this.size.leg) return
    throw new Error(
      `the ${this.name} is to be on a thing at ${this.spot(plan, 0)}, which moves faster than its limb can follow: it is ${off.toFixed(2)} m behind it. Move the thing slower. It is let free`,
    )
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

  /** works out how the joints must be for a plan, `seconds` from now as the body is going: an error if it no longer brings the limb there, and staying there it is let free */
  private aim(plan: Plan, seconds: number) {
    const aimed = this.solve(plan, seconds)
    const short = aimed.short > SLACK.reach * this.size.leg
    const keep = plan.on ? 'the thing' : 'the body'
    const how = short
      ? `its limb is ${aimed.short.toFixed(2)} m short of there: keep ${keep} where its limb reaches`
      : aimed.stuck && `as the body is going, ${aimed.stuck}`
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
