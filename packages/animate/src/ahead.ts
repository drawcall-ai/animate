import { Euler, Quaternion, Vector3 } from 'three'
import type { State } from './curve'
import type { Goal } from './goal'
import { CADENCE, UP, WALK, socket } from './hips'
import { type Joints, LAGS } from './joints'
import type { Bones } from './bones'
import { bent, leans } from './react'
import { HEEL, SIDES, type Side, other, tick } from './size'
import { stood } from './stance'
import type { Stoop } from './stoop'
import type { Mover } from './stride'

const velocity = new Vector3()
const lean = new Vector3()
const wants = new Vector3()
const next = new Vector3()
const aside = new Vector3()
const holds = new Vector3()
const euler = new Euler()
const round = new Quaternion()

export type Wound = { side: Side; leaves: number; swings: number; when: number; draws?: Goal; trunk: Goal; to: State }

/**
 * Where he will be, going as he is: the hips and the feet stepped on ahead, a tick at a time, and a free
 * trunk coming round to how they will have it lean. Whatever changes where he is going makes it `stale`, and it is
 * looked ahead anew, from the moment it is next asked.
 */
export class Ahead {
  /**
   * the swing a free trunk is to make into a fast hand: from the moment the hand sets off, as the trunk will be leaning
   * then, it `draws` back, until it does, to where it `swings` from, to how it is to be leaning and turning when the
   * hand arrives
   */
  wound?: Wound
  /** from a moment on, the hips as stepped ahead, the trunk coming round, and a copy of what they came to and how far it leant, a tick after another */
  private seen?: { from: number; mover: Mover; trunk: Goal; leant: number[]; copies: Mover[] }

  constructor(
    private readonly body: { readonly time: number },
    private readonly mover: Mover,
    private readonly joints: Joints,
    private readonly bones: Bones,
  ) {}

  get now() {
    return this.body.time
  }

  stale() {
    this.seen = undefined
  }

  /** how long from now until he first is as `found` tells, looked at a tick at a time for no longer than `most` (s) */
  first(found: (copy: Mover) => boolean, most: number) {
    for (let seconds = 0; seconds < most; seconds += tick(this.mover.size)) {
      if (found(this.look(seconds).copy)) return seconds
    }
    return undefined
  }

  get down() {
    return this.mover.stoops.longest
  }

  rise(stoop: Stoop, at: number) {
    stoop.until = at
    this.stale()
  }

  /** he as he will be `seconds` from now: the copy of him at the last whole tick, how far forward a free trunk leans then (rad), and how long past that tick it is */
  look(seconds: number) {
    if (!this.seen) {
      const trunk = this.joints.trunk.like(this.joints.trunk.value)
      trunk.velocity.copy(this.joints.trunk.velocity)
      trunk.free()
      this.seen = { from: this.mover.time, mover: this.mover.clone(), trunk, leant: [], copies: [] }
    }
    const dt = tick(this.mover.size)
    const { from, mover, trunk, leant, copies } = this.seen
    const on = Math.max(0, this.now + seconds - from) / dt
    // (a whole tick, but for what numbers round to)
    const whole = Math.floor(on + 1e-6)
    while (copies.length <= whole + LAGS + 1) {
      copies.push(mover.clone())
      mover.advance(dt)
    }
    while (leant.length <= whole) {
      leant.push(trunk.value.x)
      const bend = this.mover.stoops.bend(from + leant.length * dt)
      trunk.react(wants.set(bent(leans(copies[leant.length + LAGS]), bend), 0, 0), dt)
    }
    return { copy: copies[whole], lean: leant[whole], past: Math.max(0, on - whole) * dt }
  }

  /** how far forward a free trunk is to lean `seconds` from now: as the hips will have it lean by the time it has come round, or bent for a hand that he gets down for then */
  leans(seconds: number) {
    const { stoops, size } = this.mover
    return bent(leans(this.look(seconds + LAGS * tick(size)).copy), stoops.bend(this.now + seconds))
  }

  /** where the hips will be and how they will move `seconds` from now, in the scene */
  hips(seconds: number, value: Vector3, velocity: Vector3) {
    const { copy, past } = this.look(seconds)
    // on from the last whole tick as they are going then
    copy.scene(value.copy(copy.value).addScaledVector(velocity.copy(copy.velocity), past))
    velocity.applyAxisAngle(UP, copy.heading)
    return value
  }

  /** which way he will face `seconds` from now (rad about y, from +z toward +x) */
  facing(seconds: number) {
    const { copy, past } = this.look(seconds)
    return copy.facing + copy.spins * past
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
    const dt = tick(this.mover.size)
    const leant = lean + ((this.look(seconds + dt).lean - lean) * past) / dt
    to.y += this.turn(seconds) - this.turn(0)
    return to.setX(leant)
  }

  /** how far the hips and the feet go, and the trunk turns, from a moment to another, `seconds` from now: any way at all, before now */
  goes(from: number, to: number) {
    if (from < 0) return Infinity
    const [was, then] = [this.look(from).copy, this.look(to).copy]
    const gone = (side?: Side) => {
      const place = (copy: Mover, to: Vector3) => copy.scene(side ? copy.foot[side].at : copy.value, side, to)
      return place(was, lean).distanceTo(place(then, next))
    }
    const far = [gone(), ...SIDES.map(gone), Math.abs(was.facing - then.facing)]
    return Math.max(this.trunk(from, lean).distanceTo(this.trunk(to, next)), ...far)
  }

  /** how far the pelvis will be turned `seconds` from now, and how far it will list (rad) */
  private turn(seconds: number) {
    const { copy, past } = this.look(seconds)
    return copy.turn + copy.turning * past
  }

  private list(seconds: number) {
    const { copy, past } = this.look(seconds)
    return copy.list + copy.listing * past
  }

  /** where a hip will be: it goes as the hips go and the pelvis turns, and its leg faces as he does. With `hips` given, where it is with them there */
  hip(side: Side, seconds: number, at: Vector3, turned: Quaternion, hips = this.hips(seconds, at, velocity)) {
    const facing = this.facing(seconds)
    turned.setFromAxisAngle(UP, facing)
    socket(this.mover.size, side, this.turn(seconds), this.list(seconds), aside).applyAxisAngle(UP, facing)
    return at.copy(hips).add(aside)
  }

  /** where a shoulder will be: it goes as the hips go, over a pelvis turned as it will be, and is turned as the trunk is. With `hips` and a `trunk` given, where it is with them so */
  shoulder(
    side: Side,
    seconds: number,
    at: Vector3,
    turned: Quaternion,
    hips = this.hips(seconds, at, velocity),
    trunk = this.trunk(seconds, lean),
  ) {
    const facing = this.facing(seconds)
    turned.setFromEuler(euler.setFromVector3(trunk))
    this.bones.shoulder(side, hips, facing, this.turn(seconds), this.list(seconds), turned, at)
    turned.premultiply(round.setFromAxisAngle(UP, facing))
    return at
  }

  /** where the ankle of a foot the body steps with will be at a whole tick: on the ground its heel comes up as its leg needs it to */
  private ankle(side: Side, seconds: number, to: Vector3) {
    const { copy } = this.look(seconds)
    const { at, down, toes } = copy.foot[side]
    copy.scene(at, side, holds)
    if (!down) return to.copy(holds)
    // (its leg faces as the foot points, and all of it is told as it faces)
    const faces = copy.heading + toes
    const hip = copy.hip(side, aside).applyAxisAngle(UP, -faces)
    stood(copy.size, this.joints.legs[side], holds.applyAxisAngle(UP, -faces), hip, 0, HEEL, to)
    return to.applyAxisAngle(UP, faces)
  }

  stepped(side: Side, seconds: number, at: Vector3) {
    const dt = tick(this.mover.size)
    return this.ankle(side, seconds, at).lerp(this.ankle(side, seconds + dt, next), this.look(seconds).past / dt)
  }

  /**
   * whether he spares a foot from a moment `until` another: in the air, for as long as he is; off the ground, once the
   * steps have come out as they were to and the other foot is down, or to arrive on the ground at a run, soon will be,
   * where its leg reaches it for as long as a foot is down: which it was last the tick before none is
   */
  spare(side: Side, seconds: number, until: number) {
    const { copy } = this.look(seconds)
    const flown = this.look(until).copy.unheld
    const { beat, pace } = copy.size
    const dt = tick(copy.size)
    if (copy.falls) return flown > until - seconds - dt
    // (faster than he walks, he leaves the ground off it as long before the other foot is down as he is in the air at a
    // run)
    const leap = Math.abs(copy.velocity.z) > WALK.speed * pace && !flown ? CADENCE * beat : 0
    const stands = this.look(seconds + leap).copy
    const last = this.look(Math.max(seconds, until - (flown && flown + dt))).copy
    const { down } = stands.foot[other(side)]
    return !copy.plant && down && stands.reaches(other(side), stands.local(last.scene(last.value, undefined, aside)))
  }
}
