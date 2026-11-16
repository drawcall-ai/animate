import { clamp, Gait, HEEL, raised, type Side, SIDES, SIGN, SOLE, UP } from '@drawcall/gait'
import { type Xyz } from '@drawcall/plan'
import { type Bones } from './rig/bones'
import { type Joints, RANGE } from './rig/joints'
import { type Limb } from './rig/limb'
import { type Story, waits } from './story'
import { type Quaternion, Vector3 } from 'three'
import type { Asks } from './posture'

/** how fast a heel comes down again, and comes up (rad a beat), and how finely it is brought up (rad) */
const ROLL = { down: 1.8, up: 9, step: 0.01, exact: 1e-4 }
/** how many times a beat a foot in the air comes round to how it hangs, and an ankle eases to where it is to be from where it was as its foot came down or left */
const COMES = { foot: 9, ankle: 6 }
/** how far off the ground a foot in the air keeps its toe and heel (in legs) */
const TOE = 0.02
/** how near as high as sent the hips count as there (in legs) */
const HIGH = 0.034

type Clock = { readonly time: number }
/** a foot as the rest of the body has it: whether a story has it, where its ankle is, where the ground holds it, and to give it back */
export type Foothold = { readonly held: boolean; readonly value: Vector3; anchor?: Vector3; free(): void }
const yawOf = (turn: Quaternion) => {
  const way = new Vector3(0, 0, 1).applyQuaternion(turn)
  return Math.atan2(way.x, way.z)
}
const at = new Vector3()
const ankle = new Vector3()
const from = new Vector3()

/**
 * Where the ankle of a foot on the ground is: where it stands, or up and on from there, the heel up as far as the leg
 * needs to reach it from its hip, and as far as keeps the shin from leaning further over the foot than an ankle bends
 * and the thigh from going further back than a hip lets it: within `least` and `most`. Tells how far up the heel is.
 */
function stood(size: Bones['size'], leg: Limb, anchor: Vector3, hip: Vector3, least: number, most: number, to: Vector3) {
  const short = () => hip.distanceTo(to) > leg.length
  const fits = (angle: number) => {
    const { y, z } = raised(size, Math.max(0, angle))
    to.set(anchor.x, anchor.y + y, anchor.z + z)
    if (short()) return false
    const { first, fold } = leg.reach(from.copy(to).sub(hip))
    return first.x <= RANGE.thigh.x[1] && first.x + fold - angle <= RANGE.ankle.x[1]
  }
  let angle = least
  while (angle < HEEL && !fits(angle) && (anchor.z < hip.z || short())) angle += ROLL.step
  for (let step = ROLL.step / 2; angle > least && step > ROLL.exact; step /= 2) if (fits(angle - step)) angle -= step
  const heel = Math.min(most, angle)
  fits(heel)
  return heel
}

/**
 * The body over the gait: the hips where the gait plans them, shifted for what the hands ask, and the legs reaching the
 * gait's feet from hips the pelvis turns and lists, a heel coming up as the leg needs and rolling down again.
 */
export class Legs {
  readonly hips = { value: new Vector3(), velocity: new Vector3() }
  readonly gait: Gait
  private readonly heel = { left: 0, right: 0 }
  private readonly pitch = { left: 0, right: 0 }
  private readonly toes = { left: 0, right: 0 }
  private readonly down = { left: true, right: true }
  private readonly ankle = { left: new Vector3(), right: new Vector3() }
  private readonly eased = { left: new Vector3(), right: new Vector3() }
  /** for how long no foot of his own has been on the ground (s) */
  private unheld = 0
  /** how he was led since the last update */
  private led?: { x: number; z: number }
  /** where the world has him by the end of the next update */
  private placed?: { x: number; z: number }

  constructor(
    private readonly clock: Clock,
    private readonly bones: Bones,
    private readonly joints: Joints,
    /** what his hands ask of the hips and the trunk */
    readonly posture: Asks,
  ) {
    const gait = (this.gait = new Gait(bones.size))
    // (how low his hands have him is in the hips' plan)
    gait.low = (time) => posture.low(time)
    this.hips.value.copy(gait.hips.value)
  }

  get facing() {
    return yawOf(this.gait.hips.turn)
  }

  get ground() {
    return this.gait.lead.place.y
  }

  /** where a foot of his own stands on the ground, while it does */
  stands(side: Side) {
    const { gait } = this
    const foot = gait.feet[side]
    return gait.steps[side] || foot.outside || foot.frames.length || gait.jumps ? undefined : foot.value.clone()
  }

  /** a step of time: a foot the story has is where it has it, and the gait steps on, writing its frames anew */
  step(dt: number, feet: Record<Side, Foothold>) {
    const { gait } = this
    const now = this.clock.time + dt
    for (const side of SIDES) gait.hold(side, feet[side].held ? feet[side].value : undefined)
    // (left with no foot of his own on the ground for longer than he can be in the air, he comes down on both: the story has them no longer)
    const standing = SIDES.some((side) => !feet[side].held && !gait.steps[side]) || gait.jumps
    this.unheld = standing ? 0 : this.unheld + dt
    if (this.unheld > this.bones.size.beat) for (const side of SIDES) if (feet[side].held) feet[side].free()
    gait.advance(now)
    // (a foot the story has is watched: how fast it moves is how it moved; a foot on the hips goes on from where they were, before they go on)
    for (const side of SIDES) gait.feet[side].advance(now)
    gait.hips.advance(now)
    for (const side of SIDES) if (!feet[side].held) feet[side].anchor = this.stands(side)
    this.place()
  }

  /** the hips as planned, let down and shifted ahead for what the hands ask, as of now: what the ends read as they go on */
  private place() {
    const { gait } = this
    const now = gait.time
    this.hips.value.copy(gait.hips.value).add({ x: Math.sin(this.facing) * this.posture.shift(now), y: 0, z: Math.cos(this.facing) * this.posture.shift(now) })
    this.hips.velocity.copy(gait.hips.velocity)
  }

  /** the legs of the feet of his own reach them from where the hips are, and the hips are told */
  pose(dt: number, feet: Record<Side, Foothold>) {
    const { gait, joints, bones } = this
    const { size } = bones
    this.place()
    for (const side of SIDES) {
      const foot = gait.feet[side]
      const toes = (this.toes[side] = yawOf(foot.turn))
      if (feet[side].held) continue
      const hip = this.hip(side, new Vector3()).applyAxisAngle(UP, -toes)
      const leg = joints.legs[side]
      const down = !gait.steps[side] && !this.coming(side)
      const [roll, rise] = [(ROLL.down * dt) / size.beat, (ROLL.up * dt) / size.beat]
      if (!down) this.heel[side] = this.pitch[side]
      const was = this.heel[side]
      const anchor = at.copy(foot.value).applyAxisAngle(UP, -toes)
      if (down) this.heel[side] = stood(size, leg, anchor, hip, was - clamp(was, -roll, roll), Math.min(HEEL, was + rise), ankle)
      else ankle.copy(anchor)
      // (coming down, or leaving the ground heel up, it goes on from where its ankle was, and eases to where it is to be)
      if (down !== this.down[side]) this.eased[side].copy(this.ankle[side]).applyAxisAngle(UP, -toes).sub(ankle)
      this.down[side] = down
      ankle.add(this.eased[side].multiplyScalar(Math.exp((-COMES.ankle * dt) / size.beat)))
      this.ankle[side].copy(ankle).applyAxisAngle(UP, toes)
      const { first, fold } = leg.reach(from.copy(ankle).sub(hip))
      leg.first.follow(first, dt)
      leg.second.follow(from.set(fold, 0, 0), dt)
    }
  }

  /** whether a foot has frames still to come: one met now, as the numbers round, is not */
  private coming(side: Side) {
    const { gait } = this
    return gait.feet[side].frames.some(({ at }) => (at ?? Infinity) > gait.time + 1e-6 * this.bones.size.beat)
  }

  /** where a hip is, the pelvis turned and listing as it is */
  private hip(side: Side, to: Vector3) {
    const { turn, list } = this.gait.pelvis
    to.set(Math.cos(turn) * Math.cos(list), Math.sin(list), -Math.sin(turn) * Math.cos(list)).multiplyScalar(SIGN[side] * this.bones.size.hip)
    return to.applyAxisAngle(UP, this.facing).add(this.hips.value)
  }

  /** how far a foot is bent toe down against its shin (rad): on the ground flat or on its ball, in the air square to its shin, no further than the ground lets it */
  tread(side: Side, foot: Foothold, dt: number) {
    const { size } = this.bones
    const { first: thigh, second: shin } = this.joints.legs[side]
    const own = !foot.held && !this.gait.steps[side] && !this.coming(side)
    const hangs = this.pitch[side] + (thigh.value.x + shin.value.x - this.pitch[side]) * Math.min(1, (COMES.foot * dt) / size.beat)
    // (in the air its toe and heel keep a little off the ground)
    const high = Math.max(0, foot.value.y - this.ground - size.ankle - (own ? 0 : TOE * size.leg))
    const tipped = (sole: number) => {
      const up = (high + size.ankle) / Math.hypot(sole, size.ankle)
      return up < 1 ? Math.asin(up) - Math.atan2(size.ankle, sole) : Infinity
    }
    this.pitch[side] = own ? this.heel[side] : clamp(hangs, -tipped(SOLE.behind * size.leg), tipped(SOLE.ball * size.leg))
    const [least, most] = RANGE.ankle.x
    return clamp(this.pitch[side] - thigh.value.x - shin.value.x, -most, -least)
  }

  /** the hips as the bones are turned from them */
  posed() {
    const { gait } = this
    const { pelvis, hips } = gait
    return {
      value: this.hips.value,
      velocity: this.hips.velocity,
      turn: pelvis.turn,
      turning: pelvis.turning,
      list: pelvis.list,
      listing: pelvis.listing,
      facing: this.facing,
      spins: hips.spin.y,
      lifted: pelvis.breathes(this.bones.size.trunk),
      toes: this.toes,
    }
  }

  /** led between updates, he is led from the moment the update is for */
  places(time: number) {
    if (this.led) this.gait.go(this.led, time)
    if (this.placed) this.gait.at(this.placed, time)
    this.led = this.placed = undefined
  }

  /** he is to be going so along the ground, from the next update */
  go(velocity: { x: number; z: number }) {
    this.led = { x: velocity.x, z: velocity.z }
  }

  /** where the world has him by the end of the next update, and how high the ground under him is */
  at(place: { x: number; y?: number; z: number }) {
    if (place.y !== undefined) this.gait.lead.place.y = place.y
    this.placed = place
  }

  /** the hips go to a place on the ground, or keep so high as he goes */
  to(target: Xyz | { y: number }, way?: { speed?: number; plant?: Side }): Story<boolean> {
    const { gait } = this
    if ('x' in target) {
      gait.walk(target, way)
      return waits(() => true, () => gait.arrived)
    }
    gait.height = Math.min(this.bones.size.stand, target.y)
    return waits(() => true, () => Math.abs(gait.hips.value.y - gait.height) < HIGH * this.bones.size.leg)
  }
}
