import { Object3D, Vector3 } from 'three'
import { type State, between, keeps as within, quickest } from './curve'
import type { Grip, Pose } from './fingers'
import { type Goal, MOST, timed } from './goal'
import { SLACK, sway } from './limb'
import { JOINTS, NONE, type Plan, Planner, drawn } from './planner'
import { type Reaching, type Target, moves } from './track'
import { EXACT, type Story, type Xyz, due, waits } from './world'

/**
 * The far end of a limb: a foot or a hand. Sending it somewhere is one thing, however it is said: a place, in the
 * world, on him or on a thing, a velocity to arrive with, and a moment, given or the first there is. For that a plan is
 * made at once, as near what is asked as the body can come: what it cannot do it does as nearly, as fast and as soon
 * as it can. What it is sent to is carried out in the order it was sent: it sets off for a later send no sooner than it
 * has been where an earlier one sent it, and stays there until then. On its way its joints are aimed anew every step,
 * as near where it is to be as they turn, however the body turns out to go, no harder than they can be pushed. One that
 * arrived moving is the body's again, and swings on as one limb, its end going on across it, before it comes round to
 * where the body wants it; one that arrived at rest stays there until it is sent elsewhere or let `free`, or as near
 * as its limb has it. A foot sent to rest on the ground is not planned: the body steps there with it and stands over
 * it. A hand sent somewhere turned arrives turned as near so as its wrist turns it. One sent to rest on a thing keeps
 * to it however the thing moves, lagging behind it as it must.
 */
export class End extends Planner {
  /** where it is and how it is moving: the body tells, from where its limb has put it */
  readonly value = new Vector3()
  readonly velocity = new Vector3()
  /** where the ground holds it, if it does */
  anchor?: Vector3
  /** whether it is where it was last sent and stays there, as near as an end counts as there */
  get there() {
    return this.plan?.there === true
  }

  /** when it sets off for where it was last sent, and the moment it is to be there, if it is sent anywhere */
  get last() {
    const plan = this.sent.at(-1)
    return plan && { leaves: plan.leaves, when: plan.when }
  }

  /** the things it follows: those it is on, or is sent to be on */
  get follows() {
    return this.sent.flatMap(({ on }) => (on instanceof Object3D ? [on] : []))
  }

  /**
   * Sends the end to a place: one `on` him is counted from where its limb starts, the shoulder or the hip, and goes
   * with it. The velocity it arrives with is how it moves in the scene then, wherever the place is counted
   * from. Given `seconds`, it sets off at once and takes that long, or is there as soon after as it can be; otherwise
   * it is there the first moment it can be, having taken its time, with a short wind-up. Asked to arrive faster than it
   * can, it arrives as fast as it can. The story it returns is over at that moment, or once a foot stands where it was
   * sent to step, and gives whether it was there then: false if it came short, or was sent elsewhere before. A hand
   * can instead be sent by a grip to a thing, closing its fingers on it as the grip has them by then, and stays on it.
   */
  to(place: Xyz | Grip, { seconds, ...arriving }: Reaching & { seconds?: number } = {}): Story<boolean> {
    timed(this.name, seconds)
    const target = this.target(place, arriving)
    const lands =
      this.kind === 'foot' && !target.on && target.place.y <= this.carrier.ground + this.size.ankle + EXACT && !moves(target)
    if (!lands) return this.send(target, seconds, true)
    if (seconds !== undefined) {
      throw new Error(`the ${this.name} is sent to step somewhere in ${seconds} s, and a step takes the time it takes`)
    }
    this.free()
    const put = this.put(target.place)
    const foot = this.carrier.foot(this.side)
    return waits(
      () => foot.put === put,
      () => foot.down && put !== undefined && foot.at.distanceTo(put) < EXACT,
    )
  }

  /**
   * Has the end be at a place at a moment, on the clock of `update`: until it has to set off it goes on as it is.
   * A moment it cannot keep it keeps as soon after as it can. The story it returns is over at that moment, and gives
   * false if it was sent elsewhere before.
   */
  by(when: number, place: Xyz | Grip, arriving: Reaching = {}): Story<boolean> {
    if (Number.isNaN(when)) throw new Error(`the ${this.name} is to be somewhere by a moment that is no number`)
    return this.send(this.target(place, arriving), Math.max(when - this.clock, this.after), false)
  }

  /**
   * Has the fingers of a hand take a pose, or with none relax, and hold it until they are given another, whatever
   * else the hand does: in the time fingers take, or `by` a moment, setting off as late as they can for that. The story
   * it returns is over when they have it, and gives false if they were given another before.
   */
  shape(pose?: Pose, { by }: { by?: number } = {}): Story<boolean> {
    return this.fingers('are to take a pose').shape(pose, by === undefined ? undefined : by - this.clock)
  }

  /**
   * Lets the end go: it is no longer on its way anywhere or kept at a place, and its limb is the body's again.
   */
  free() {
    for (const { stoop } of this.waiting.splice(0)) if (stoop) this.carrier.rise(stoop, this.clock)
    // with no fast arrival left to set off for, the rest of the body has none to swing into
    if (this.kind === 'hand') this.carrier.wind.off(this.side)
    // what the story does not have is the body's already
    if (this.held) this.release()
    this.claim()
    if (this.kind === 'foot') this.put()
  }

  /** has the body step with the foot to a place on the ground and stand over it there: or with none, keep it there no longer. Tells where it is to stand so, if it is */
  private put(place?: Vector3) {
    const put = this.carrier.put(this.side, place)
    this.carrier.stale()
    return put
  }

  /**
   * The story lets the limb go: it is the body's, and its joints swing out and come round to how the body wants them
   * in the time the limb sways there and back. Let go as it arrives moving, it goes on as one: it turns on about its
   * first joint as carries its end on across it, and folds no further.
   */
  private release() {
    const { plan } = this
    if (plan?.stoop) this.carrier.rise(plan.stoop, this.clock)
    this.plan = undefined
    // (its joints swing on as they were turning, and come round to how the body wants them)
    for (const joint of JOINTS) this.limb[joint]?.release(sway(this.limb))
  }

  /**
   * Makes the plan for a target and has the end wait to set off for it, after what it was sent to before: for
   * `seconds` from now, setting off at once if it is to be `direct`, or for the first moment that has a plan.
   */
  private send(target: Target, seconds: number | undefined, direct: boolean): Story<boolean> {
    // what he is down for where it was sent before he will be down for only until it sets off: as soon as it can, as far as is known yet
    const stoops = this.sent.flatMap((plan) => plan.stoop ?? [])
    const untils = stoops.map(({ until }) => until)
    for (const stoop of stoops) this.carrier.rise(stoop, Math.min(stoop.until, this.clock + this.after))
    const wait = direct && seconds !== undefined ? this.after + seconds : seconds
    const fit = () => (wait === undefined ? undefined : this.fit(target, wait, { given: true, direct }))
    const given = fit()
    // (what does not reach there at that moment reaches no nearer later: only one with too little time is there later)
    const exact = given && 'when' in given && !given.near?.slow ? given : undefined
    if (!exact) this.drop(given)
    // (with too little time it is there as soon after as it can be)
    const nearest = () => {
      const plan = given && 'when' in given ? fit() : undefined
      return plan && 'when' in plan ? plan : undefined
    }
    const found = exact ?? this.scan(target, false, wait) ?? nearest()
    const after = this.clock + this.after
    // (one with no plan at all goes after it at once, in the time the limb swings over, not as hard as it can, and
    // comes as near as it does)
    const plan = found ?? { ...target, when: after + sway(this.limb) / 2, leaves: after, swing: 0, near: NONE }
    if (!found) this.claim(plan)
    stoops.forEach((stoop, k) => this.carrier.rise(stoop, Math.min(untils[k], plan.leaves)))
    this.waiting.push(plan)
    // (a grip is handed over whole: the fingers close as it has them, by the moment the hand is on the thing)
    const fingers = this.limb.hand?.fingers
    if (target.grip && fingers) void fingers.shape(target.grip.pose, plan.when - this.clock)
    return this.carried(plan)
  }

  /** whether it is where a plan has it, as near as an end counts as there */
  private on(plan: Plan) {
    return this.tipped(plan, 0, this.value.clone()).distanceTo(this.where(plan, 0)) <= SLACK.place * this.size.leg
  }

  /** a story over at a plan's moment, or once it is sent elsewhere: whether it was there then */
  private *carried(plan: Plan): Story<boolean> {
    while (this.sent.includes(plan) && plan.there === undefined) yield
    return plan.there === true
  }

  /**
   * On a thing it follows, once its moment has come, its joints are put at once where they have it on the thing as the
   * thing is now, as far as they turn: a hand that follows a thing is derived from it, not planned behind it
   */
  pin() {
    const { plan } = this
    if (!plan || !(plan.on instanceof Object3D) || moves(plan) || !due(this.clock, plan.when)) return
    this.see(plan.on)
    const aimed = this.solve(plan, 0)
    for (const joint of JOINTS) {
      const [part, turn] = [this.limb[joint], aimed[joint]]
      if (!part || !turn) continue
      part.value.copy(turn.value)
      part.velocity.copy(turn.velocity)
    }
  }

  /**
   * At its moment it is as near where it was sent as it came, and what arrived moving is let go, to swing out: and a
   * foot that stays somewhere in the air, as he comes down, for the ground. One to stay on a thing is there once it is
   * on it. A thing moves only between updates: the first step of one is told it is, a `frame`, and what the end is on
   * or sent to is looked at anew.
   */
  arrive(frame: boolean) {
    const thing = this.sent.map(({ on }) => on).find((on) => on instanceof Object3D)
    if (frame && thing) {
      this.inScene(thing)
      this.see(thing)
    }
    const { plan } = this
    if (!plan || !due(this.clock, plan.when)) return
    // it is there while it is as near where it is to be as an end counts as there
    plan.there = this.on(plan)
    // (what he got down for it he stays down for while it is there, and no longer: going away from it, he comes up)
    if (!plan.there && plan.stoop && plan.stoop.until > this.clock) this.carrier.rise(plan.stoop, this.clock)
    const lands = this.kind === 'foot' && this.carrier.landing
    if (!moves(plan) && !(this.waiting.length === 0 && lands)) return
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
    const seconds = Math.max(going.when - now, dt)
    const aimed = this.solve(going, seconds)
    if (aimed.stuck) this.near(aimed)
    const back = drawn(aimed, going.swing, this.limb)
    // it goes no harder than its joints can be pushed, and lags if it must
    const takes = (joint: Goal, to: State, most: number) =>
      joint.takes(to, most) <= MOST ? most : Math.max(most, quickest(joint, to, MOST * joint.strength, joint.range))
    const ways = JOINTS.flatMap((joint) => {
      const [part, drawn, turn] = [this.limb[joint], back[joint], aimed[joint]]
      if (!part || !drawn || !turn) return []
      // with longer than a joint swings for, it draws back first to where it swings from
      const draws = seconds > drawn.swing
      const to = draws ? drawn : turn
      return [{ part, to, seconds: takes(part, to, draws ? seconds - drawn.swing : seconds) }]
    })
    // swinging on loose, its joints turn each as it was: sent on so that one would turn past how far it turns, the limb
    // is slowed as one, as little as keeps every joint within that (a limb sent somewhere already turns as one)
    const slowed = (share: number) =>
      ways.every(({ part, to, seconds }) =>
        within({ value: part.value, velocity: part.velocity.clone().multiplyScalar(share) }, to, seconds, part.range),
      )
    const share = !ways.some(({ part }) => part.loose) || slowed(1) ? 1 : between(0, 1, slowed)[0]
    for (const { part, to, seconds } of ways) {
      part.velocity.multiplyScalar(share)
      part.drive(to, seconds)
    }
  }

  /** it sets off: the limb is the story's from now on */
  private leave(plan: Plan, seconds: number) {
    const { first, second } = this.limb
    // a leg the body has stepped with goes on as the body had it turning at the moment it was to set off: over the last step of time it may just have come straight
    const strode = this.strides(seconds - plan.when + plan.leaves)
    if (strode) [first.velocity.x, second.velocity.x] = [strode.first.velocity.x, strode.second.velocity.x]
    this.waiting.shift()
    this.plan = plan
    this.anchor = undefined
    if (this.kind === 'foot') this.put()
  }
}
