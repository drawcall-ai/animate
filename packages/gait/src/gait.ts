import { Channel, type Frame } from '@drawcall/plan'
import { Quaternion, Vector3 } from 'three'

export type Side = 'left' | 'right'
const SIDES: Side[] = ['left', 'right']
const SIGN = { left: 1, right: -1 }
const UP = new Vector3(0, 1, 0)
const GRAVITY = 9.81
/** what the gait's measures are counted in: how long a leg is, how far out a hip is, how high the hips and an ankle stand (m) */
export type Size = { leg: number; hip: number; stand: number; ankle: number }

/** how far ahead the hips are led to the speed asked (s): how soon he gets up to it */
const AHEAD = 0.35
/** how many steps a second he takes, at the least and for every m/s; how much of a stride a foot is down walking and running fast */
const CADENCE = { least: 1.7, faster: 0.3, most: 3.2 }
const DUTY = { walk: 0.62, run: 0.36 }
/** how high a foot is lifted mid-step, at the least and for every m/s (in lengths of his leg) */
const LIFT = { least: 0.07, faster: 0.04 }
/** how far a foot may lie from where it belongs under him, and turn from the way he faces, before he steps to it (m of leg, rad) */
const SETTLED = { far: 0.06, turned: 0.25 }
/** how much lower than standing the hips go at a walk and at a run (in lengths of his leg) */
const LOW = { walk: 0.03, run: 0.06 }
/** how fast he turns at the most (rad/s) */
const SPIN = 8

/** the moment he will be at, the place on the ground with y the ankle, and the turn about y */
const yaw = (angle: number) => new Quaternion().setFromAxisAngle(UP, angle)
const angleOf = (turn: Quaternion) => {
  const ahead = new Vector3(0, 0, 1).applyQuaternion(turn)
  return Math.atan2(ahead.x, ahead.z)
}

/**
 * Walking and running, as frames: the gait writes a frame for the hips from the lead (where he is to be going), and for
 * each foot in the air the frames of its step (lifted halfway, down where the hips will be over it), cancelled and
 * written anew every step as the lead changes. A run to a place on a foot is the same with fixed frames. A jump is
 * three frames on the hips: the takeoff (its draw-back is the crouch), the landing (on the parabola), and swinging on
 * into the knees. A channel someone else has written frames to is theirs until they are done with it.
 */
export class Gait {
  readonly hips: Channel
  readonly feet: Record<Side, Channel>
  /** how far through a stride he is (0..1): the left foot leaves the ground at 0, the right at ½ */
  phase = 0
  stepping = false
  private readonly lead = new Vector3()
  private faces?: number
  private now = 0
  /** a run to a place: the moment the planted foot is down there, and which foot */
  private plant?: { side: Side; at: number; spot: Vector3; speed: number }

  constructor(readonly size: Size) {
    this.hips = new Channel('hips', 40, 0.25 * size.leg)
    this.hips.set({ x: 0, y: size.stand - LOW.walk * size.leg, z: 0 })
    this.feet = { left: this.foot('left'), right: this.foot('right') }
  }

  private foot(side: Side) {
    const foot = new Channel(`${side} foot`, 400, 0.3 * this.size.leg)
    foot.set(this.under(side, this.hips.value, 0))
    foot.settle = () => (foot.value.y > this.size.ankle + 0.01 ? this.landing(side, this.now + 0.25) : undefined)
    return foot
  }

  /** where a foot belongs under hips at a place, facing so */
  private under(side: Side, hips: Vector3, facing: number) {
    const out = new Vector3(SIGN[side] * this.size.hip, 0, 0).applyAxisAngle(UP, facing)
    return out.add(hips).setY(this.size.ankle)
  }

  /** he is led: going so along the ground (m/s), and facing a way, or the way he goes */
  go(velocity: { x: number; z: number }, face?: { x: number; z: number }) {
    this.lead.set(velocity.x, 0, velocity.z)
    this.plant = undefined
    if (face) this.faces = Math.atan2(face.x, face.z)
    else if (this.lead.length() > 0.3) this.faces = Math.atan2(velocity.x, velocity.z)
  }

  /**
   * He runs to plant a foot at a place, arriving at `arrive` m/s: the hips get a fixed frame, the planted foot a fixed
   * footfall, and the strides are timed to come out even on it. Tells the moment it is down.
   */
  run({ at, plant, speed, arrive = 0 }: { at: { x: number; z: number }; plant: Side; speed: number; arrive?: number }) {
    const spot = new Vector3(at.x, this.size.ankle, at.z)
    const from = this.hips.value.clone().setY(0)
    const way = spot.clone().setY(0).sub(from)
    const far = way.length()
    way.normalize()
    const facing = Math.atan2(way.x, way.z)
    const when = this.now + far / (0.7 * speed + 0.3 * arrive)
    // the hips come over the planted foot, from its side, slowing to `arrive`
    const hips = spot.clone().addScaledVector(new Vector3(SIGN[plant] * this.size.hip, 0, 0).applyAxisAngle(UP, facing), -0.8)
    hips.addScaledVector(way, -0.15 * this.size.leg).setY(this.size.stand - LOW.run * this.size.leg)
    this.hips.cancel()
    this.hips.by({ at: when, place: hips, velocity: way.clone().multiplyScalar(arrive), turn: yaw(facing), by: 'gait' })
    this.lead.set(0, 0, 0)
    this.faces = facing
    this.plant = { side: plant, at: when, spot, speed: 0.7 * speed + 0.3 * arrive }
    this.stepping = true
    return when
  }

  /** he jumps for the hips to be at the top at a place: the takeoff's draw-back is his crouch. Tells the moment of the top */
  jump(top: { x: number; y: number; z: number }) {
    const { stand } = this.size
    const rise = Math.max(0.05, top.y - stand)
    const up = Math.sqrt(2 * GRAVITY * rise)
    const flies = up / GRAVITY
    const from = this.hips.value.clone().setY(stand)
    const across = new Vector3(top.x - from.x, 0, top.z - from.z).divideScalar(flies)
    const leaves = this.now + (27 / 4) * this.hips.reach / up
    const takeoff = { at: leaves, place: from, velocity: across.clone().setY(up), by: 'jump' }
    const lands = from.clone().addScaledVector(across, 2 * flies)
    this.hips.cancel()
    this.hips.by(takeoff)
    this.hips.by({ at: leaves + 2 * flies, place: lands, velocity: across.clone().setY(-up), by: 'jump' })
    // the feet leave with him, drawn up under him, and come down under where he lands
    for (const side of SIDES) {
      const foot = this.feet[side]
      foot.cancel()
      const tucked = new Vector3(SIGN[side] * this.size.hip, -0.8 * this.size.leg, 0.05)
      foot.by({ at: leaves + 0.05, on: this.hips, place: { x: tucked.x, y: -0.97 * this.size.leg, z: 0 }, by: 'jump' })
      foot.by({ at: leaves + flies, on: this.hips, place: tucked, by: 'jump' })
      foot.by({ at: leaves + 2 * flies - 0.02, place: this.under(side, lands, angleOf(this.hips.turn)), by: 'jump' })
    }
    this.stepping = false
    return leaves + flies
  }

  /** the frame that sets a foot down where it belongs, by a moment */
  private landing(side: Side, at: number): Frame {
    const facing = this.faces ?? angleOf(this.hips.turn)
    const hips = new Vector3()
    this.hipsAt(at, hips)
    return { at, place: this.under(side, hips, facing), turn: yaw(facing), by: 'gait' }
  }

  /** where the hips will be at a moment: as their frames have them, and on at the lead after those */
  private hipsAt(t: number, at: Vector3) {
    const last = Math.min(t, this.now + AHEAD)
    this.hips.state(this.plant ? t : last, at, new Vector3())
    if (!this.plant) at.addScaledVector(this.lead, t - last)
    return at
  }

  /** steps on to `now`: writes the frames for the hips and for each foot in the air, after what is asked now */
  advance(now: number) {
    const dt = now - this.now
    this.now = now
    if ([this.hips, ...SIDES.map((side) => this.feet[side])].some((one) => one.busy && one.owner === 'jump')) return
    const speed = this.plant ? this.plant.speed : this.lead.length()
    const facing = this.faces ?? angleOf(this.hips.turn)
    if (!this.plant) {
      // the hips are led: from the state they are in, to be going as led a little ahead
      const there = this.hips.value.clone().addScaledVector(this.lead.clone().add(this.hips.velocity).setY(0), AHEAD / 2)
      there.y = this.size.stand - (speed > 2.5 ? LOW.run : LOW.walk) * this.size.leg
      const turned = facing - angleOf(this.hips.turn)
      const spun = angleOf(this.hips.turn) + Math.max(-SPIN * AHEAD, Math.min(SPIN * AHEAD, Math.atan2(Math.sin(turned), Math.cos(turned))))
      if (!this.hips.busy || this.hips.owner === 'gait') {
        this.hips.cancel('gait')
        this.hips.by({ at: now + AHEAD, place: there, velocity: this.lead, turn: yaw(spun), by: 'gait' })
      }
    }
    // the stride clock goes round while he goes, or a foot is out of place; it stops with both feet down
    const cadence = Math.min(CADENCE.most, CADENCE.least + CADENCE.faster * speed)
    const duty = DUTY.walk + (DUTY.run - DUTY.walk) * Math.min(1, Math.max(0, (speed - 1.8) / 2))
    const swing = (1 - duty) / 2
    if (!this.stepping) this.stepping = speed > 0.1 || SIDES.some((side) => this.astray(side, facing))
    if (!this.stepping) return
    let rate = cadence / 2
    if (this.plant) rate = this.timed(rate, swing)
    const was = this.phase
    this.phase = (this.phase + rate * dt) % 1
    for (const side of SIDES) {
      const foot = this.feet[side]
      const starts = side === 'left' ? 0 : 0.5
      const through = (this.phase - starts + 1) % 1
      const left = (swing - through) / rate
      // (a foot someone else has sent is theirs from a swing before their frame)
      const theirs = foot.frames.find((frame) => frame.by !== 'gait')
      if (through >= swing || (theirs && now + left > (theirs.at ?? now) - 0.4)) continue
      // in the air: its footfall is where the hips will be over it halfway through its time down
      const lands = now + left
      const hips = this.hipsAt(lands + (duty / rate) * 0.25, new Vector3())
      let place = this.under(side, hips, facing)
      if (this.plant?.side === side && Math.abs(lands - this.plant.at) < 0.5 / rate) place = this.plant.spot.clone()
      const lift = (LIFT.least + LIFT.faster * Math.min(speed, 4)) * this.size.leg
      foot.cancel('gait')
      if (through < swing / 2) {
        const mid = place.clone().add(foot.value).multiplyScalar(0.5).setY(this.size.ankle + lift)
        const velocity = place.clone().sub(foot.value).setY(0).divideScalar(Math.max(left, 0.05))
        foot.by({ at: now + (swing / 2 - through) / rate, place: mid, velocity, by: 'gait' })
      }
      foot.by({ at: lands, place, turn: yaw(facing), by: 'gait' })
    }
    // he stops once he is still and both feet are down where they belong, between strides
    const down = SIDES.every((side) => !this.feet[side].busy)
    const turnedOver = Math.floor(was * 2) !== Math.floor(this.phase * 2)
    if (speed < 0.1 && !this.plant && down && turnedOver && !SIDES.some((side) => this.astray(side, facing))) this.stepping = false
    if (this.plant && now > this.plant.at) this.stepping = false
  }

  /** a foot lies too far from where it belongs, or is turned too far from the way he faces */
  private astray(side: Side, facing: number) {
    const foot = this.feet[side]
    const off = foot.value.distanceTo(this.under(side, this.hips.value, facing))
    const turned = angleOf(foot.turn) - facing
    return off > SETTLED.far * this.size.leg || Math.abs(Math.atan2(Math.sin(turned), Math.cos(turned))) > SETTLED.turned
  }

  /** the stride rate that has the planted foot come down at its moment, on a whole number of strides from now */
  private timed(natural: number, swing: number) {
    const { side, at } = this.plant!
    const left = at - this.now
    if (left <= 0) return natural
    const lands = ((side === 'left' ? 0 : 0.5) + swing - this.phase + 2) % 1
    const strides = Math.max(0, Math.round(natural * left - lands))
    return (lands + strides) / left
  }
}
