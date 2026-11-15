import { Euler, Quaternion, Vector3 } from 'three'
import type { Goal } from './goal'
import { CADENCE, WALK } from './gait'
import { socket } from './pelvis'
import { type Joints, LAGS } from './joints'
import type { Bones } from './bones'
import { bent, leans } from './reactions'
import { HEEL, type Side, other, tick } from './size'
import { stood } from './stance'
import type { Stoop } from './stoops'
import type { Mover } from './mover'
import { Winder } from './wind'
import { wrap, UP } from './world'

const velocity = new Vector3()
const lean = new Vector3()
const wants = new Vector3()
const next = new Vector3()
const aside = new Vector3()
const holds = new Vector3()
const euler = new Euler()
const round = new Quaternion()

/**
 * Where he will be, going as he is: the hips and the feet stepped on ahead, a tick at a time, and a free
 * trunk coming round to how they will have it lean. Whatever changes where he is going makes it `stale`, and it is
 * looked ahead anew, from the moment it is next asked.
 */
export class Ahead {
  /** the wind-up for a fast hand, which turns the trunk meanwhile */
  readonly wind: Winder
  /** from a moment on, the hips as stepped ahead, the trunk coming round from how it was then, and a copy of what they came to and how far it leant, a tick after another */
  private cache?: {
    from: number
    mover: Mover
    trunk: Goal
    begun: Record<'value' | 'velocity', Vector3>
    leant: number[]
    copies: Mover[]
  }

  constructor(
    private readonly body: { readonly time: number },
    private readonly mover: Mover,
    private readonly joints: Joints,
    private readonly bones: Bones,
  ) {
    this.wind = new Winder(this, mover, joints)
  }

  get now() {
    return this.body.time
  }

  /**
   * what changes where he is going from a moment on makes him be looked ahead anew from then: only what he gets down
   * for is read as he is stepped on, and not kept in a copy, so anything else changes him from now
   */
  stale(from = this.now) {
    const { cache } = this
    if (!cache) return
    const kept = Math.floor((from - cache.from) / tick(this.mover.size) + 1e-6) - 1
    if (kept < 1 || from <= this.now) return (this.cache = undefined)
    if (kept >= cache.copies.length) return void (cache.leant.length = 0)
    cache.copies.length = kept
    cache.mover = cache.copies[kept - 1].clone()
    cache.copies.length = kept - 1
    cache.leant.length = 0
  }

  /** how long from now until he first is as `found` tells, looked at a tick at a time for no longer than `most` (s) */
  first(found: (copy: Mover) => boolean, most: number) {
    for (let seconds = 0; seconds < most; seconds += tick(this.mover.size)) {
      if (found(this.at(seconds).copy)) return seconds
    }
    return undefined
  }

  get down() {
    return this.mover.stoops.longest
  }

  /** he is down for something until a moment: which changes where he is going from then, and never before he got down for it */
  rise(stoop: Stoop, at: number) {
    const was = stoop.until
    stoop.until = at
    this.stale(Math.max(Math.min(was, at), Math.min(stoop.sinks, stoop.bends)))
  }

  /** he as he will be `seconds` from now: the copy of him at the last whole tick, how far forward a free trunk leans then (rad), and how long past that tick it is */
  at(seconds: number) {
    const { trunk: turning } = this.joints
    this.cache ??= {
      from: this.mover.time,
      mover: this.mover.clone(),
      trunk: turning.like(turning.value),
      begun: { value: turning.value.clone(), velocity: turning.velocity.clone() },
      leant: [],
      copies: [],
    }
    const dt = tick(this.mover.size)
    const { from, mover, leant, copies, begun } = this.cache
    if (leant.length === 0) {
      this.cache.trunk = turning.like(begun.value)
      this.cache.trunk.velocity.copy(begun.velocity)
      this.cache.trunk.free()
    }
    const { trunk } = this.cache
    const on = Math.max(0, this.now + seconds - from) / dt
    // (a whole tick, but for what numbers round to)
    const whole = Math.floor(on + 1e-6)
    while (copies.length <= whole + LAGS + 1) {
      copies.push(mover.clone())
      mover.advance(dt)
    }
    // (and toward where he looks)
    const looked = this.gaze()?.x ?? 0
    while (leant.length <= whole) {
      leant.push(trunk.value.x)
      const bend = this.mover.stoops.bend(from + leant.length * dt)
      trunk.react(wants.set(bent(leans(copies[leant.length + LAGS]), bend) + looked, 0, 0), dt)
    }
    return { copy: copies[whole], lean: leant[whole], past: Math.max(0, on - whole) * dt }
  }

  /** how far the trunk turns toward where he looks, if he does, besides the body's own turns: its share of the look (rad about x and y) */
  gaze() {
    const { look, facing } = this.mover
    const share = this.bones.looks
    return look && { x: -look.pitch * share, y: wrap(look.yaw - facing) * share }
  }

  /** how far forward a free trunk is to lean `seconds` from now: as the hips will have it lean by the time it has come round, or bent for a hand that he gets down for then, and `more` */
  leans(seconds: number, more = 0) {
    const { stoops, size } = this.mover
    return bent(leans(this.at(seconds + LAGS * tick(size)).copy), stoops.bend(this.now + seconds) + more)
  }

  /** where the hips will be and how they will move `seconds` from now, in the scene */
  hips(seconds: number, value: Vector3, velocity: Vector3) {
    const { copy, past } = this.at(seconds)
    // on from the last whole tick as they are going then
    copy.scene(value.copy(copy.value).addScaledVector(velocity.copy(copy.velocity), past))
    velocity.applyAxisAngle(UP, copy.heading)
    return value
  }

  /** which way he will face `seconds` from now (rad about y, from +z toward +x) */
  facing(seconds: number) {
    const { copy, past } = this.at(seconds)
    return copy.facing + copy.spins * past
  }

  /**
   * How the trunk will be turned `seconds` from now: as it is sent, or `free`, swinging into a fast hand or coming
   * round to how he will lean by then.
   */
  trunk(seconds: number, to: Vector3, free = this.joints.trunk.reacts) {
    const { trunk } = this.joints
    const wound = this.wind.trunk(this.now + seconds, to)
    if (wound) return wound
    // (free, it stays turned as it is, but for how the pelvis will turn and he will lean)
    if (trunk.reacts) to.copy(trunk.value)
    else trunk.ahead(seconds, to, velocity)
    if (!free) return to
    const { lean, past } = this.at(seconds)
    const dt = tick(this.mover.size)
    const leant = lean + ((this.at(seconds + dt).lean - lean) * past) / dt
    to.y += this.turn(seconds) - this.turn(0)
    return to.setX(leant)
  }

  /** how far the pelvis will be turned `seconds` from now, and how far it will list (rad) */
  private turn(seconds: number) {
    const { copy, past } = this.at(seconds)
    return copy.turn + copy.turning * past
  }

  private list(seconds: number) {
    const { copy, past } = this.at(seconds)
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
    const lifted = this.at(seconds).copy.breathes
    turned.setFromEuler(euler.setFromVector3(trunk))
    this.bones.shoulder(side, hips, facing, this.turn(seconds), this.list(seconds), turned, lifted, at)
    turned.premultiply(round.setFromAxisAngle(UP, facing))
    return at
  }

  /** where the ankle of a foot the body steps with will be at a whole tick: on the ground its heel comes up as its leg needs it to */
  private ankle(side: Side, seconds: number, to: Vector3) {
    const { copy } = this.at(seconds)
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
    return this.ankle(side, seconds, at).lerp(this.ankle(side, seconds + dt, next), this.at(seconds).past / dt)
  }

  /**
   * whether he spares a foot from a moment `until` another: in the air, for as long as he is; off the ground, once the
   * steps have come out as they were to and the other foot is down, or to arrive on the ground at a run, soon will be,
   * where its leg reaches it for as long as a foot is down: which it was last the tick before none is
   */
  spare(side: Side, seconds: number, until: number) {
    const { copy } = this.at(seconds)
    const flown = this.at(until).copy.unheld
    const { beat, pace } = copy.size
    const dt = tick(copy.size)
    if (copy.falls) return flown > until - seconds - dt
    // (faster than he walks, he leaves the ground off it as long before the other foot is down as he is in the air at a
    // run)
    const leap = Math.abs(copy.velocity.z) > WALK.speed * pace && !flown ? CADENCE * beat : 0
    const stands = this.at(seconds + leap).copy
    const last = this.at(Math.max(seconds, until - (flown && flown + dt))).copy
    const { down } = stands.foot[other(side)]
    return !copy.plant && down && stands.reaches(other(side), stands.local(last.scene(last.value, undefined, aside)))
  }
}
