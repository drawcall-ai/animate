import { Euler, type Quaternion, Vector3 } from 'three'
import type { State } from './curve'
import type { Figure } from './figure'
import type { Goal } from './goal'
import { WALK, socket } from './hips'
import { type Joints, PARTS, part } from './joints'
import { LAGS, bent, leans } from './react'
import { HEEL, SIDES, type Side, other } from './size'
import { stood } from './stance'
import { type Mover, reaches } from './stride'
import { TICK } from './world'

/** how long before his other foot is down he leaves the ground off one that is to arrive on the ground, going faster than he walks: as long as he is in the air between strides at a run (s) */
const LEAP = 0.2
const velocity = new Vector3()
const lean = new Vector3()
const wants = new Vector3()
const next = new Vector3()
const aside = new Vector3()
const euler = new Euler()

export type Wound = { side: Side; leaves: number; swings: number; when: number; draws?: Goal; trunk: Goal; to: State }

/**
 * Where he will be, going as he is: the hips and the feet stepped on ahead, a step of time at a time, and a free
 * trunk coming round to how they will have it lean. Whatever changes where he is going makes it `stale`, and it is
 * looked ahead anew, from the moment it is next asked.
 */
export class Ahead {
  /** the swing a free trunk is to make into a fast hand: from the moment the hand sets off, as the trunk will be leaning then, it `draws` back, until it does, to where it `swings` from, to how it is to be leaning and turning when the hand arrives */
  wound?: Wound
  /** from a moment on, the hips as stepped ahead, the trunk coming round, and a copy of what they came to, a step of time after another */
  private seen?: { from: number; mover: Mover; trunk: Goal; leant: number[]; ticks: Mover[] }

  constructor(
    private readonly body: { readonly time: number },
    private readonly mover: Mover,
    private readonly joints: Joints,
    private readonly figure: Figure,
  ) {}

  /** the moment it is, on the body's clock */
  get now() {
    return this.body.time
  }

  stale() {
    this.seen = undefined
  }

  /** he as he will be `seconds` from now: at the last whole step of time, how far forward a free trunk leans then (rad), and how long past that step it is */
  look(seconds: number) {
    if (!this.seen) {
      const trunk = part('trunk', 'trunk', this.joints.trunk.value)
      trunk.velocity.copy(this.joints.trunk.velocity)
      trunk.free()
      this.seen = { from: this.mover.time, mover: this.mover.clone(), trunk, leant: [], ticks: [] }
    }
    const { from, mover, trunk, leant, ticks } = this.seen
    const on = Math.max(0, this.now + seconds - from) / TICK
    // (a whole step, but for what numbers round to)
    const whole = Math.floor(on + 1e-6)
    while (ticks.length <= whole + LAGS + 1) {
      ticks.push(mover.clone())
      mover.advance(TICK)
    }
    while (leant.length <= whole) {
      leant.push(trunk.value.x)
      const bend = this.mover.stoops.bend(from + leant.length * TICK)
      trunk.react(wants.set(bent(leans(ticks[leant.length + LAGS]), bend), 0, 0), PARTS.trunk.rate, TICK)
    }
    return { tick: ticks[whole], lean: leant[whole], past: Math.max(0, on - whole) * TICK }
  }

  /** how far forward a free trunk is to lean `seconds` from now: as the hips will have it lean by the time it has come round, or bent for a hand that he gets down for then */
  leans(seconds: number) {
    return bent(leans(this.look(seconds + LAGS * TICK).tick), this.mover.stoops.bend(this.now + seconds))
  }

  /** where the hips will be and how they will move `seconds` from now */
  hips(seconds: number, value: Vector3, velocity: Vector3) {
    const { tick, past } = this.look(seconds)
    // on from the last whole step as they are going then
    return value.copy(tick.value).addScaledVector(velocity.copy(tick.velocity), past)
  }

  /**
   * How the trunk will be turned `seconds` from now: as it is sent, or `free`, swinging into a fast hand or coming
   * round to how he will lean by then.
   */
  trunk(seconds: number, to: Vector3, free = this.joints.trunk.reacts) {
    const { trunk } = this.joints
    const { wound } = this
    const then = this.now + seconds
    if (wound && then >= wound.swings) return wound.trunk.ahead(then - wound.swings, to, velocity)
    if (wound?.draws && then >= wound.leaves) return wound.draws.ahead(then - wound.leaves, to, velocity)
    // (free, it stays turned as it is, but for how the pelvis will turn and he will lean)
    if (trunk.reacts) to.copy(trunk.value)
    else trunk.ahead(seconds, to, velocity)
    if (!free) return to
    const { lean, past } = this.look(seconds)
    const leant = lean + ((this.look(seconds + TICK).lean - lean) * past) / TICK
    to.y += this.turn(seconds) - this.turn(0)
    return to.setX(leant)
  }

  /** how far the hips and the feet go, and the trunk turns, from a moment to another, `seconds` from now: any way at all, before now */
  goes(from: number, to: number) {
    if (from < 0) return Infinity
    const [was, then] = [this.look(from).tick, this.look(to).tick]
    const feet = SIDES.map((side) => was.foot[side].at.distanceTo(then.foot[side].at))
    return Math.max(this.trunk(from, lean).distanceTo(this.trunk(to, next)), was.value.distanceTo(then.value), ...feet)
  }

  /** how far the pelvis will be turned `seconds` from now (rad) */
  private turn(seconds: number) {
    const { tick, past } = this.look(seconds)
    return tick.turn + tick.turning * past
  }

  /** where a hip will be: it goes as the hips go and the pelvis turns, and its leg is not turned. With `hips` given, where it is with them there */
  hip(side: Side, seconds: number, at: Vector3, turned: Quaternion, hips = this.hips(seconds, at, velocity)) {
    turned.identity()
    return at.copy(hips).add(socket(side, this.turn(seconds), this.look(seconds).tick.list, aside))
  }

  /** where a shoulder will be: it goes as the hips go and is turned as the trunk is. With `hips` and a `trunk` given, where it is with them so */
  shoulder(
    side: Side,
    seconds: number,
    at: Vector3,
    turned: Quaternion,
    hips = this.hips(seconds, at, velocity),
    trunk = this.trunk(seconds, lean),
  ) {
    turned.setFromEuler(euler.setFromVector3(trunk))
    return at.copy(hips).add(next.copy(this.figure.arms[side].upper.position).applyQuaternion(turned))
  }

  /** where the ankle of a foot the body steps with will be at a whole step of time: on the ground its heel comes up as its leg needs it to */
  private ankle(side: Side, seconds: number, to: Vector3) {
    const { tick } = this.look(seconds)
    const { at, down } = tick.foot[side]
    if (!down) return to.copy(at)
    stood(this.joints.legs[side], at, tick.value, socket(side, tick.turn, tick.list, aside), 0, HEEL, to)
    return to
  }

  /** where the ankle of a foot the body steps with will be */
  stepped(side: Side, seconds: number, at: Vector3) {
    return this.ankle(side, seconds, at).lerp(this.ankle(side, seconds + TICK, next), this.look(seconds).past / TICK)
  }

  /** whether he spares a foot from a moment `until` another: in the air, for as long as he is; off the ground, once the steps have come out as they were to and the other foot is down, or to arrive on the ground at a run, soon will be, where its leg reaches it for as long as a foot is down: which it was last the step before none is */
  spare(side: Side, seconds: number, until: number) {
    const { tick } = this.look(seconds)
    const flown = this.look(until).tick.unheld
    if (tick.falls) return flown > until - seconds - TICK
    const leap = Math.abs(tick.velocity.z) > WALK.speed && !flown ? LEAP : 0
    const stands = this.look(seconds + leap).tick
    const held = this.look(Math.max(seconds, until - (flown && flown + TICK))).tick
    const { at, down } = stands.foot[other(side)]
    return !tick.plant && down && reaches(at, held.value)
  }
}
