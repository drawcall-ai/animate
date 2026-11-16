import { Vector3 } from 'three'
import { cubic, EASE, type Xyz } from '@drawcall/plan'
import { type Story, waits } from '../story'
import { AXES, bounds, hardest, quickest, type Range, type State, within } from './curve'

export const REST = { x: 0, y: 0, z: 0 }
/** how many times its strength a part may be asked for before it says it cannot */
export const MOST = 2

/** how a part is to arrive, and in how long */
type Arrival = { velocity?: Xyz; seconds?: number }
type Way = { arrived: boolean }
const state = () => ({ value: new Vector3(), velocity: new Vector3() })
/** how it will be at the end of a way it is still to go */
const then = state()
/** how a free part is pushed toward what is wanted of it, and how fast that would have it */
const push = new Vector3()
const pushed = new Vector3()

export function timed(name: string, seconds: number | undefined) {
  if (seconds !== undefined && !(seconds > 0 && seconds < Infinity)) {
    throw new Error(`the ${name} is sent somewhere in ${seconds} s`)
  }
}

/** What a story has of a part that turns: where it is and how it moves, and to send it somewhere or give it back to the body. */
export type Part = Readonly<Pick<Goal, 'value' | 'velocity' | 'to' | 'free'>>

/**
 * A value on its way: a place (m) or a rotation (rad about x, y and z), of a part with a `strength`: the most it can
 * accelerate. Sent `to` a target, it gets there as quickly as its strength lets it, on the smoothest way from
 * wherever it is and however it is moving: a fast arrival makes it draw back first, and it cannot stop dead. It
 * arrives moving as asked, at rest unless a velocity is given: then it is let go. A part can instead `follow` what
 * leads it, or be `free` to `react`: at once, or let go, to swing out and come round first.
 */
export class Goal {
  readonly value = new Vector3()
  readonly velocity = new Vector3()
  /** the way it is on: from how it was to how it is to arrive, in so many seconds, of which so many are gone */
  private readonly from = state()
  private readonly target = state()
  private seconds = 0
  private gone = 0
  private way?: Way
  /** what moves it: its own goal, what it follows, or its reactions */
  private moved: 'sent' | 'follows' | 'free' = 'sent'
  /** whether it has been let go, and is swinging out: once it has come round it is the body's */
  loose = false
  /** what the body last wanted of it, free */
  private readonly wanted = new Vector3()

  /**
   * `name` is what the part is called when it cannot do what is asked; it goes only within its `range`, and draws
   * back no further than that; free, it comes round `rate` times a second.
   */
  constructor(
    readonly name: string,
    value: Xyz,
    readonly strength: number,
    readonly range: Range,
    readonly rate = 0,
  ) {
    this.value.copy(value)
  }

  /** a part like it, turned so: for what this one would do to be told */
  like(value: Xyz = REST) {
    return new Goal(this.name, value, this.strength, this.range, this.rate)
  }

  /**
   * Sends the value to a target, in `seconds` if given: as near as it goes, and as soon after as it can be if that is
   * too soon. The story it returns is over when it has arrived, and gives false if it was sent elsewhere before that.
   */
  to(target: Xyz, { velocity = REST, seconds }: Arrival = {}): Story<boolean> {
    timed(this.name, seconds)
    if (![...AXES].every((axis) => Number.isFinite(target[axis]) && Number.isFinite(velocity[axis]))) {
      throw new Error(`the ${this.name} is sent somewhere, or to arrive moving, as no numbers say`)
    }
    // (as near as it turns, and in no less time than it takes)
    const to = { value: within(new Vector3().copy(target), this.range), velocity }
    return this.drive(to, Math.max(seconds ?? 0, quickest(this, to, MOST * this.strength, this.range)))
  }

  /** Sends the value somewhere in `seconds`, however hard that is: what a limb does with its joints, having seen to their strength itself. */
  drive(to: State, seconds: number): Story<boolean> {
    this.loose = false
    const way = this.leave(to, seconds)
    return waits(
      () => this.way === way,
      () => way.arrived,
    )
  }

  get arrived() {
    return this.way?.arrived === true
  }

  /** how hard it is pushed at the most to get somewhere in `seconds`, from how it is now or `from` how it will be: in times its strength */
  takes(to: State, seconds: number, from: State = this) {
    return hardest(from, to, seconds, this.strength)
  }

  /** where a part that is sent will be and how it will move `seconds` from now: past the end of a way it arrives moving on, let go and coming round */
  ahead(seconds: number, value: Vector3, velocity: Vector3) {
    const past = seconds - this.seconds + this.gone
    if (past < 0) {
      return cubic((this.gone + seconds) / this.seconds, this.seconds, this.from, this.target, value, velocity)
    }
    const lasts = this.swings(this.target.velocity)
    if (lasts === 0) return value.copy(this.target.value)
    then.value.copy(this.wanted)
    return cubic(Math.min(1, past / lasts), lasts, this.target, then, value, velocity)
  }

  /** how long what is let go moving so takes to swing out and come round (s): as long as has it slowed at its ease, on its smoothest way */
  private swings(velocity: Xyz) {
    return Math.max(...AXES.map((axis) => (4 * Math.abs(velocity[axis])) / (EASE * this.strength)))
  }

  /**
   * Lets the part go, however it is moving: over `seconds` it comes round, on its smoothest way, to what the body
   * wants of it, which has it swing out first, and is then the body's again.
   */
  release(seconds: number) {
    this.leave({ value: this.wanted, velocity: REST }, seconds)
    this.loose = true
  }

  /**
   * let go, it makes for what the body now wants of it in the time it has left to come round, and no longer than
   * `within`: true until that is up, or with no such time to keep to, what is wanted has changed so late that it would
   * have to be pushed harder than it can be, and it is the body's at once
   */
  private comes(wanted: Xyz, within = Infinity) {
    this.wanted.copy(wanted)
    const remains = Math.min(this.seconds - this.gone, within)
    if (!this.loose || remains <= 0) return false
    const to = { value: this.wanted, velocity: REST }
    const comes = within < Infinity || this.takes(to, remains) <= MOST
    if (comes) this.leave(to, remains)
    else this.free()
    return comes
  }

  /** what comes to the end of its range is stopped there, however hard that is */
  private stopped() {
    for (const axis of AXES) {
      const [least, most] = bounds(this.range, axis)
      if (this.value[axis] >= least && this.value[axis] <= most) continue
      this.value[axis] = Math.min(most, Math.max(least, this.value[axis]))
      this.velocity[axis] = 0
    }
  }

  /** gives the part back to the body, to react */
  free() {
    this.loose = false
    this.moved = 'free'
    this.wanted.copy(this.value)
    this.way = undefined
  }

  get reacts() {
    return this.moved === 'free'
  }

  private leave(to: State, seconds: number) {
    const way = { arrived: false }
    this.moved = 'sent'
    this.from.value.copy(this.value)
    this.from.velocity.copy(this.velocity)
    this.target.value.copy(to.value)
    this.target.velocity.copy(to.velocity)
    this.seconds = seconds
    this.gone = 0
    this.way = way
    if (seconds <= 0) {
      way.arrived = true
      this.value.copy(to.value)
      this.velocity.copy(to.velocity)
    }
    return way
  }

  advance(dt: number) {
    if (this.moved !== 'sent') return
    const remains = this.seconds - this.gone
    if (remains > 0) {
      this.gone += Math.min(dt, remains)
      cubic(this.gone / this.seconds, this.seconds, this.from, this.target, this.value, this.velocity)
    }
    this.stopped()
    if (dt <= remains) return
    if (this.way) this.way.arrived = true
    if (this.loose) return this.free()
    // what is left of the step it goes on as it arrived: and what arrived moving is let go
    this.value.addScaledVector(this.velocity, dt - Math.max(0, remains))
    if (this.velocity.lengthSq() > 0) this.release(this.swings(this.velocity))
  }

  /**
   * Takes a value from whatever leads this part, and its velocity from how that value changed over `dt`: let go, it
   * first comes round to it, `within` so long.
   */
  follow(value: Xyz, dt: number, within?: number) {
    if (this.comes(value, within)) return
    this.loose = false
    this.moved = 'follows'
    if (dt > 0) this.velocity.copy(value).sub(this.value).divideScalar(dt)
    this.value.copy(value)
  }

  /** a free part goes after what the body wants of it like a weight on a spring, without overshooting: let go, it first comes round to it */
  react(wanted: Xyz, dt: number) {
    if (this.comes(wanted) || this.moved !== 'free') return
    const pull = 2 * Math.PI * this.rate
    // stepped so that it holds for any step of time
    push.subVectors(this.wanted, this.value).multiplyScalar(pull * pull * dt)
    pushed.addVectors(this.velocity, push).divideScalar((1 + pull * dt) ** 2)
    // and pushed no harder than what is not sent anywhere is
    for (const axis of AXES) {
      const most = EASE * this.strength * dt
      this.velocity[axis] += Math.max(-most, Math.min(most, pushed[axis] - this.velocity[axis]))
    }
    this.value.addScaledVector(this.velocity, dt)
    this.stopped()
  }
}
