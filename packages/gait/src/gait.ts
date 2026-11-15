import { Channel } from '@drawcall/plan'
import { Quaternion, Vector3 } from 'three'
import { Lead } from './lead'
import { angleOf, ahead, bob, dip, HEEL, left, over, raised, type Side, SIDES, SIGN, type Size, SOLE, STILL, TOGETHER, UP, wide, wrap } from './measure'
import { Pelvis } from './pelvis'
import { duty, footfall, type Going, rate } from './stride'
import { type Step, swing } from './swing'

/** when ahead of now the hips' frames are written (s): the first sets how soon he answers a new lead */
const MARKS = [0.1, 0.2, 0.35, 0.5, 0.7]
/** how near how high the legs reach the hips ride before they give to it (in legs) */
const SOFT = 0.03
/** how strong the hips and a foot are (m/s²) */
const STRENGTH = { hips: 300, foot: 2000 }
/** how fast a footfall is moved once aimed, at the most (in paces) */
const SHIFT = 0.68
/** how far through its swing a foot is when its footfall is moved no faster than that */
const LATE = 0.6

const yaw = (angle: number) => new Quaternion().setFromAxisAngle(UP, angle)
const yawOf = (turn: Quaternion) => {
  const way = new Vector3(0, 0, 1).applyQuaternion(turn)
  return angleOf(way.x, way.z)
}
/** where in the stride a foot's swing begins, and how far through its share of it it is at a phase */
const start = (side: Side) => (side === 'left' ? 0 : 0.5)
const through = (side: Side, phase: number) => (((phase - start(side)) % 1) + 1) % 1

/**
 * Walking and running, as frames: each step the gait cancels the frames it wrote and writes them anew from how he is
 * led and the state he is in, so a new lead is answered at once and he goes on smoothly. The hips get frames along
 * where he will be, riding and swaying with the stride; each foot in the air the rest of its swing to a footfall
 * aimed anew; a foot on the ground no frame at all, so it stays where it is. One clock, going as fast as his speed and
 * turning ask, says when each foot leaves the ground and comes down. It keeps nothing else: the plan is where he will be.
 */
export class Gait {
  readonly hips: Channel
  readonly feet: Record<Side, Channel>
  readonly lead: Lead
  readonly pelvis: Pelvis
  /** how far through a stride he is (0..1): the left foot leaves the ground at 0, the right at ½; and whether he steps */
  phase = 0
  stepping = false
  /** each foot's step through the air, while it is in it */
  readonly steps: Partial<Record<Side, Step>> = {}
  /** the hips as the strides last had them, how many strides a second, and how much of one a foot is down */
  going: Going
  rate = 1
  duty = 0.6
  /** the moment it has stepped on to (s) */
  time = 0
  private was = 0

  constructor(readonly size: Size) {
    this.lead = new Lead(size)
    this.pelvis = new Pelvis(size)
    this.hips = new Channel('hips', STRENGTH.hips, 0)
    this.hips.set({ x: 0, y: size.stand, z: 0 })
    this.feet = { left: this.foot('left'), right: this.foot('right') }
    this.going = this.lead.advance(0, {})
  }

  private foot(side: Side) {
    const foot = new Channel(`${side} foot`, STRENGTH.foot, 0)
    foot.set(new Vector3(SIGN[side] * this.size.hip, this.size.ankle, 0))
    return foot
  }

  /** he is led: going so along the ground (m/s) from a moment, by default now, the lead telling where he will be by how it changes */
  go(velocity: { x: number; z: number }, at = this.time) {
    this.lead.go(velocity, at)
  }

  /** he faces a way along the ground at a walk, wherever he goes; with none, the way he goes */
  face(way?: { x: number; z: number }) {
    this.lead.face = way && angleOf(way.x, way.z)
  }

  /** the world has him on the ground at a place now, as a character controller does */
  at(place: { x: number; z: number }) {
    this.lead.place.set(place.x, this.lead.place.y, place.z)
  }

  /** where on the ground the hips will be in so long: as he is led */
  private path(seconds: number) {
    return this.lead.at(seconds)
  }

  /**
   * where a foot stands for hips over a place `seconds` from now: where it is down, or for one on its way down, as
   * far from them as it will be from where they are as it comes down
   */
  private stands(side: Side, ground: Vector3, seconds: number) {
    const step = this.steps[side]
    if (!step) return this.feet[side].value
    const lands = step.lands - this.time
    return lands <= seconds ? step.to : step.to.clone().sub(this.path(lands)).add(ground)
  }

  /** how high the hips ride over a place on the ground, so far through a stride: down for a leg to reach ahead, bobbing, and no higher than the legs reach the feet */
  private ride(ground: Vector3, seconds: number, phase: number, facing: number) {
    const { size } = this
    const speed = this.going.speed
    const middle = 1 - this.duty + this.duty * over(size, speed)
    const bounce = this.stepping ? bob(size, speed) * Math.cos(4 * Math.PI * (phase - middle)) : 0
    const ride = ground.y + size.stand - dip(size, speed) + bounce
    // (from the feet that are down by then, or on their way down)
    const down = SIDES.filter((side) => !this.stepping || this.steps[side] || through(side, phase) >= 1 - this.duty)
    const reach = Math.max(
      ...down.map((side) => {
        const at = this.stands(side, ground, seconds)
        const hip = left(facing).multiplyScalar(SIGN[side] * size.hip).add(ground)
        const heel = raised(size, HEEL)
        const flat = Math.max(0, Math.hypot(at.x - hip.x, at.z - hip.z) - heel.z)
        return at.y + heel.y + Math.sqrt(Math.max(0, size.leg ** 2 - flat ** 2))
      }),
    )
    if (!down.length) return Math.min(ride, ground.y + size.stand)
    const soft = SOFT * size.leg
    const off = reach - ride
    return Math.min(ride + Math.min(0, off) - soft * Math.log1p(Math.exp(-Math.abs(off) / soft)), ground.y + size.stand)
  }

  /** how far to his left of the way he goes the hips sway over the foot he stands on, so far through a stride (m) */
  private sway(phase: number) {
    if (!this.stepping) return this.pelvis.over
    const pull = 9.81 / this.size.stand
    const often = (2 * Math.PI * this.rate) ** 2
    const swing = 1 - this.duty
    return ((this.size.hip * pull) / (pull + often)) * Math.sin(2 * Math.PI * (phase - 0.25 - swing / 2))
  }

  /** where the hips are to be in so long: over where he will be, riding and swaying with the stride, and facing so */
  private planned(seconds: number) {
    const ground = this.path(seconds)
    const phase = this.phase + this.rate * seconds
    const { facing, spins, aims } = this.going
    const turned = facing + Math.sign(spins) * Math.min(Math.abs(spins * seconds), spins * aims > 0 ? Math.abs(aims) : 0)
    const place = left(facing).multiplyScalar(this.sway(phase)).add(ground)
    place.y = this.ride(ground, seconds, phase, facing)
    return { place, turn: turned }
  }

  /** how far a foot down is from where it belongs under the hips, pointing the way he is to face: at its ball (m) */
  private strays(side: Side, going: Going) {
    const foot = this.feet[side]
    const home = left(going.facing).multiplyScalar(SIGN[side] * wide(this.size, 0)).add(going.at)
    const turned = ahead(yawOf(foot.turn)).sub(ahead(going.facing + going.aims)).multiplyScalar(SOLE.ball * this.size.leg)
    return home.sub(foot.value).setY(0).add(turned).length()
  }

  /** steps on to `now`: the lead goes on, the clock goes round, and the hips' and the feet's frames are written anew */
  advance(now: number) {
    const dt = now - this.time
    this.was = this.time
    this.time = now
    if (dt <= 0) return
    const { size, hips, feet } = this
    const toes = Object.fromEntries(SIDES.filter((side) => !this.steps[side]).map((side) => [side, yawOf(feet[side].turn)]))
    const going = (this.going = this.lead.advance(dt, toes))
    const { leg, pace } = size
    this.rate = rate(size, going)
    this.duty = duty(size, going, 1 / this.rate)
    const swingShare = 1 - this.duty
    // the clock goes round while he goes, or a foot is out of place; it stops with both feet down where they belong
    const moving = Math.abs(going.speed) > STILL * pace || Math.abs(going.aims) > TOGETHER
    const strays = Object.fromEntries(SIDES.map((side) => [side, this.steps[side] ? Infinity : this.strays(side, going)])) as Record<Side, number>
    const away = Math.max(strays.left, strays.right)
    if (!this.stepping && (moving || away > TOGETHER * leg)) {
      this.stepping = true
      this.phase = (strays.left >= strays.right ? 0 : 0.5) - 1e-6
    }
    const was = this.phase
    if (this.stepping) this.phase += this.rate * dt
    // the hips: frames along where he will be, written anew
    if (!hips.busy || hips.owner === 'gait') {
      hips.cancel('gait')
      for (const mark of MARKS) {
        const { place, turn } = this.planned(mark)
        const later = this.planned(mark + 1e-3).place
        hips.by({ at: now + mark, place, velocity: later.sub(place).divideScalar(1e-3), turn: yaw(turn), by: 'gait' })
      }
    }
    for (const side of SIDES) this.tread(side, was, going, swingShare, moving, strays[side])
    if (this.stepping && !moving && !this.steps.left && !this.steps.right && away < TOGETHER * leg) this.stepping = false
    const down = Object.fromEntries(SIDES.map((side) => [side, { at: feet[side].value, down: !this.steps[side] }])) as Record<Side, { at: Vector3; down: boolean }>
    const speed = Math.hypot(hips.velocity.x, hips.velocity.z)
    const banks = Math.atan(Math.max(-0.5, Math.min(0.5, (going.speed * going.curves) / 9.81))) * Math.cos(going.facing - going.heading)
    const free = !this.stepping && !moving
    this.pelvis.advance(dt, hips.value, speed, 0, going.facing, banks, down, free)
  }

  /** a foot: it leaves the ground as its share of the stride begins, swings to its footfall, aimed anew, and comes down */
  private tread(side: Side, was: number, going: Going, swingShare: number, moving: boolean, strays: number) {
    const { size, feet, time: now } = this
    const foot = feet[side]
    // (a foot someone else has written frames to is theirs)
    if (foot.frames.some((frame) => frame.by !== 'gait')) {
      delete this.steps[side]
      return
    }
    const [before, after] = [through(side, was), through(side, this.phase)]
    if (this.stepping && after < before && !this.steps[side] && (moving || strays > (TOGETHER * size.leg) / 2)) {
      const pointed = yawOf(foot.turn)
      this.steps[side] = { side, from: foot.value.clone(), leaves: now, to: foot.value.clone(), lands: now, pointed, toes: pointed }
    }
    const step = this.steps[side]
    if (!step) return
    if (after >= swingShare || (after < before && step.leaves < now)) {
      delete this.steps[side]
      return
    }
    const partner = side === 'left' ? 'right' : 'left'
    const prior = this.steps[partner]
    const last = prior && through(partner, this.phase) > after ? prior.to : (prior?.from ?? feet[partner].value)
    const lands = (swingShare - after) / this.rate
    const { to, toes } = footfall(size, going, side, lands, this.duty / this.rate, last, (seconds) => this.path(seconds))
    to.y = this.lead.place.y + size.ankle
    // (aimed anew late in its swing, the footfall moves no faster than a foot in the air is brought round: so it never skids in)
    if (after > LATE * swingShare) to.sub(step.to).clampLength(0, SHIFT * size.pace * (now - this.was)).add(step.to)
    Object.assign(step, { to, toes, lands: now + lands })
    foot.cancel('gait')
    for (const frame of swing(size, step, now, going.speed, feet[partner].value, going.facing)) foot.by(frame)
  }

  /**
   * What the gait means to do, for whoever looks: the lead, how far through its stride it is, where each foot stands or
   * is to come down next and in how long, and the hips' way over the next second
   */
  intent() {
    const feet = SIDES.map((side) => {
      const step = this.steps[side]
      return { side, stands: this.feet[side].value.clone(), lands: step?.to.clone(), in: step && step.lands - this.time }
    })
    return { lead: this.lead.velocity.clone(), phase: this.phase, stepping: this.stepping, plant: undefined as Vector3 | undefined, feet, hips: this.hips.intent().path, facing: this.going.facing }
  }
}
