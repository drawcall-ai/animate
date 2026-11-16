import { Channel } from '@drawcall/plan'
import { Quaternion, Vector3 } from 'three'
import { Course, type Way } from './course'
import { jump, type Jump } from './jump'
import { Lead } from './lead'
import { angleOf, ahead, bob, other, GRAVITY, PUSH, RUN, SLOW, WALK, dip, HEEL, left, over, raised, type Side, SIDES, SIGN, type Size, SOLE, STILL, TOGETHER, UP, wide, wrap } from './measure'
import { Pelvis } from './pelvis'
import { duty, footfall, type Going, rate } from './stride'
import { type Step, swing } from './swing'

/** when ahead of now the hips' frames are written (s): the first sets how soon he answers a new lead */
const MARKS = [0.1, 0.2, 0.35, 0.5, 0.7]
/** how far ahead along a way he is sent the hips' frames go at the most (s) */
const FAR = 4
/** how near how high the legs reach the hips ride before they give to it (in legs) */
const SOFT = 0.03
/** how strong the hips and a foot are (m/s²) */
const STRENGTH = { hips: 300, foot: 2000 }
/** how much less than its length a leg reaches standing over a foot put down (in legs) */
const SLACK = 0.023
/** how long a foot takes to step where a story puts it, if it does not say (in beats) */
const PLACE = 1.5
/** how far off a place is that he steps to as he faces rather than turn to it (in legs) */
const KEEPS = 0.85
/** how many times as fast the clock goes while a leg reaches its foot on the ground no longer */
const CATCH = 4
/** how long before a frame someone else wrote to a foot it sets off, if it does not say (s) */
const TAKES = 0.3
/** how fast a foot the story has moves against the hips at the least while he stands on the other (in paces) */
const SWUNG = 0.3
/** how long he takes at the least to crouch for a jump (s) */
const CROUCH = 0.3

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
  /** how high the hips are held over the ground, standing (m) */
  height: number
  /** a run or a walk he is led along, the foot to plant where it ends and when the hips come over it, and the foot he stays on there */
  course?: Course
  private plant?: { side: Side; at: number; stride: number }
  private planted?: Side
  /** whether he keeps facing as he did, stepping to a place close by */
  private keeps = false
  /** a jump he is making */
  jumping?: Jump & { course?: Course }
  /** a foot a story puts somewhere, on its way there */
  private readonly placing: Partial<Record<Side, Step>> = {}

  constructor(readonly size: Size) {
    this.lead = new Lead(size)
    this.pelvis = new Pelvis(size)
    this.hips = new Channel('hips', STRENGTH.hips, 0)
    this.hips.set({ x: 0, y: size.stand, z: 0 })
    this.feet = { left: this.foot('left'), right: this.foot('right') }
    this.height = size.stand
    this.going = this.lead.advance(0, {})
  }

  private foot(side: Side) {
    const foot = new Channel(`${side} foot`, STRENGTH.foot, 0)
    foot.set(new Vector3(SIGN[side] * this.size.hip, this.size.ankle, 0))
    return foot
  }

  /** he is led: going so along the ground (m/s) from a moment, by default now, the lead telling where he will be by how it changes */
  go(velocity: { x: number; z: number }, at = this.time) {
    if (this.course || this.planted || (Math.hypot(velocity.x, velocity.z) > SLOW * this.size.pace && SIDES.some((side) => this.feet[side].owner === 'story'))) this.sent()
    const was = this.lead.velocity.clone()
    this.lead.go(velocity, at)
    // (led anew, the plan is where he will be from now)
    if (was.distanceTo(this.lead.velocity) > 0.05) this.plan()
  }

  /** he faces a way along the ground at a walk, wherever he goes; with none, the way he goes */
  face(way?: { x: number; z: number }) {
    this.lead.face = way && angleOf(way.x, way.z)
  }

  /** the world has him on the ground at a place now, as a character controller does */
  at(place: { x: number; z: number }) {
    const by = new Vector3(place.x, this.lead.place.y, place.z).sub(this.lead.place)
    // (further off than he steps, he is there at once, feet and all)
    if (by.length() > KEEPS * this.size.leg) {
      for (const channel of [this.hips, ...SIDES.map((side) => this.feet[side])]) channel.set(channel.value.clone().add(by), channel.turn)
      for (const step of [...Object.values(this.steps), ...Object.values(this.placing)]) [step.from, step.to].forEach((one) => one.add(by))
    }
    this.lead.place.set(place.x, this.lead.place.y, place.z)
  }

  /** what he was sent to do is over: he is sent anew */
  private sent() {
    // (sent somewhere, he steps off feet the story put down: they are his again)
    for (const side of SIDES) if (this.feet[side].owner === 'story') this.feet[side].cancel('story')
    this.course = this.plant = this.planted = undefined
    if (this.keeps) this.lead.face = undefined
    this.keeps = false
    this.height = this.size.stand
  }

  /**
   * He runs to a place on the ground (the hips come by it), turning to go there, sped up so hard, keeping to `speed`
   * and braked to `arrive` there, or to rest; with a foot to `plant`, the strides come out even onto it there, and at
   * rest he stays on it. Tells the moment the hips come by the place.
   */
  run({ at, speed, plant, push = 5, arrive = speed }: { at: { x: number; z: number }; speed: number; plant?: Side; push?: number; arrive?: number }) {
    const { size, lead } = this
    this.sent()
    const fast = Math.min(speed, RUN * size.pace)
    const way: Way = { speed: fast, push: Math.min(push, PUSH.along), arrive: Math.min(arrive, fast) }
    const place = new Vector3(at.x, lead.place.y, at.z)
    // (sent in the air, he goes from where he lands)
    const leap = this.jumping
    const [from, start, velocity] = leap ? [leap.place, leap.lands, leap.velocity] : [lead.place, this.time, this.hips.velocity.clone().setY(0)]
    const course = (this.course = new Course(size, start, from, velocity, place, way))
    // (to a place close by he keeps facing as he does, and backs or sidesteps there)
    if (lead.face === undefined && place.distanceTo(lead.place) < KEEPS * size.leg) [lead.face, this.keeps] = [lead.facing, true]
    const comes = course.when(place)
    if (plant) this.plant = { side: plant, at: comes, stride: -Infinity }
    this.plan()
    return comes
  }

  /** he walks to a place on the ground and comes to rest there, at an ease or as fast as said, on a foot if said */
  walk(to: { x: number; z: number }, { speed = WALK.speed * this.size.pace, plant }: { speed?: number; plant?: Side } = {}) {
    return this.run({ at: to, speed: Math.min(speed, WALK.most * this.size.pace), plant, push: 2, arrive: 0 })
  }

  /** he comes to a stand where his going carries him, braked as hard as a leg pushes, his feet stepping together under him */
  stand() {
    const { lead } = this
    const going = this.hips.velocity.clone().setY(0)
    this.sent()
    lead.face = undefined
    lead.go({ x: 0, z: 0 }, this.time)
    const to = lead.place.clone().addScaledVector(going, going.length() / PUSH.along)
    this.course = new Course(this.size, this.time, lead.place, going, to, { speed: Math.max(going.length(), 0.1), push: PUSH.along, arrive: 0 })
    this.plan()
  }

  /**
   * whether he can spare a foot from `seconds` from now until `until`: the footfall he plants is down by then, the
   * other foot is down, and its leg still reaches it from where the hips will be at the end
   */
  spares(side: Side, seconds: number, until: number) {
    const now = this.time
    if (this.plant && now + seconds < this.plant.at - (over(this.size, this.going.speed) * this.duty) / this.rate) return false
    const partner = other(side)
    const swing = 1 - this.duty
    const down = (t: number) => !this.stepping || this.held(side) || through(partner, this.phase + this.rate * t) >= swing
    if (!down(seconds)) return false
    const stands = this.steps[partner]?.to ?? this.feet[partner].value
    const hips = new Vector3()
    this.hips.state(now + until, hips, new Vector3())
    return this.holds(partner, stands, hips.clone().setY(this.lead.place.y), this.going.facing) >= hips.y - 0.02
  }

  /** whether he has done what he was sent to do: no way to go, no jump, his feet still */
  get arrived() {
    return !this.course && !this.jumping && !this.stepping && this.hips.velocity.length() < STILL * this.size.pace
  }

  /** whether he is making a jump */
  get jumps() {
    return this.jumping !== undefined
  }

  /**
   * He jumps for the hips to be at a place at the top: from where a run ends, as he comes over his planted foot, else
   * once he has crouched. Tells the moment he is highest.
   */
  jump(top: { x: number; y: number; z: number }) {
    const { size, lead } = this
    const course = this.course
    // (in the air, once he has come down)
    const soonest = Math.max(this.time + CROUCH, (this.jumping?.lands ?? -Infinity) + CROUCH)
    const leaves = course ? Math.max(this.plant?.at ?? course.when(course.to), soonest) : soonest
    // (from a run he takes off from the footfall where it ends: the foot his strides bring there, if none is said)
    if (course && !this.plant) {
      const then = this.phase + this.rate * (leaves - this.time)
      const off = (side: Side) => Math.abs(wrap(2 * Math.PI * (start(side) + 1 - this.duty - then)))
      this.plant = { side: off('left') < off('right') ? 'left' : 'right', at: leaves, stride: -Infinity }
    }
    const from = this.path(leaves - this.time).setY(lead.place.y)
    const going = course ? course.velocity(leaves) : lead.velocity.clone()
    const takes = this.plant?.side ?? (this.steps.left ? 'right' : 'left')
    const planned = (this.jumping = { ...jump(size, this.hips, new Vector3(top.x, top.y, top.z), this.time, leaves, from, going, this.going.facing, !course && lead.velocity.length() > SLOW * size.pace, takes), course })
    for (const frame of planned.hips) this.hips.by(frame)
    for (const side of SIDES) for (const frame of planned.feet[side]) this.feet[side].by(frame)
    return planned.top
  }

  /** the moment he is highest in the jump he is making, or now */
  highest() {
    return this.jumping?.top ?? this.time
  }

  /** the moment the hips come by a place on the way he is sent */
  when(place: { x: number; z: number }) {
    return this.course ? this.course.when(place) : this.time
  }

  /** where on the ground the hips will be in so long: along the way he is sent, or as he is led */
  private path(seconds: number) {
    if (!this.course) return this.lead.at(seconds)
    return this.course.at(this.time + seconds).setY(this.lead.place.y)
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
    const ride = ground.y + this.height - dip(size, speed) + bounce
    // (from the feet that are down by then, or on their way down)
    const down = SIDES.filter((side) => !this.held(side) && (!this.stepping || this.steps[side] || through(side, phase) >= 1 - this.duty))
    const reach = Math.max(...down.map((side) => this.holds(side, this.stands(side, ground, seconds), ground, facing)))
    if (!down.length) return Math.min(ride, ground.y + size.stand)
    const soft = SOFT * size.leg
    const off = reach - ride
    return Math.min(ride + Math.min(0, off) - soft * Math.log1p(Math.exp(-Math.abs(off) / soft)), ground.y + size.stand)
  }

  /** how high over a place on the ground the hips can be for a leg to reach its foot at a place, the heel up (m) */
  private holds(side: Side, at: Vector3, ground: Vector3, facing: number) {
    const { size } = this
    const hip = left(facing).multiplyScalar(SIGN[side] * size.hip).add(ground)
    const heel = raised(size, HEEL)
    const flat = Math.max(0, Math.hypot(at.x - hip.x, at.z - hip.z) - heel.z)
    return at.y + heel.y + Math.sqrt(Math.max(0, size.leg ** 2 - flat ** 2))
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
    // (between feet the story has put down he stands over them, as high as his legs reach both)
    const stance = this.stance()
    if (stance) return { place: stance, turn: this.going.facing }
    const ground = this.path(seconds)
    const phase = this.phase + this.rate * seconds
    const { facing, spins, aims } = this.going
    const turned = facing + Math.sign(spins) * Math.min(Math.abs(spins * seconds), spins * aims > 0 ? Math.abs(aims) : 0)
    const place = left(facing).multiplyScalar(this.sway(phase)).add(ground)
    // (and they come down no faster than they fall)
    const { value, velocity } = this.hips
    place.y = Math.max(this.ride(ground, seconds, phase, facing), value.y + velocity.y * seconds - (GRAVITY / 2) * seconds ** 2)
    return { place, turn: turned }
  }

  /** a foot a story has, from outside the gait, is where it is now; with none, it is the gait's again and steps home */
  hold(side: Side, place?: { x: number; y: number; z: number }) {
    const foot = this.feet[side]
    foot.outside = place !== undefined
    if (place) foot.value.copy(place)
  }

  /** whether a foot is someone else's: a story has put it somewhere or sends it */
  held(side: Side) {
    const { owner } = this.feet[side]
    return owner !== undefined && owner !== 'gait' && owner !== 'jump' && owner !== 'on'
  }

  /** where a foot is or is to be: its last frame, or where it is */
  private ends(side: Side) {
    const foot = this.feet[side]
    return new Vector3().copy(foot.frames.at(-1)?.place ?? foot.value)
  }

  /** standing between feet the story has put down: where the hips stand over them, and as high as his legs reach both from there */
  private stance() {
    // (a foot the story swings through the air is no stance: he goes on over the other)
    const resting = (side: Side) => this.held(side) && this.feet[side].velocity.length() < STILL * this.size.pace && !this.feet[side].frames.some((frame) => frame.velocity)
    if (!SIDES.some(resting) || SIDES.some((side) => this.held(side) && !resting(side)) || this.jumping) return undefined
    const [left, right] = SIDES.map((side) => this.ends(side))
    const half = Math.hypot(left.x - right.x, left.z - right.z) / 2
    const { leg, hip, stand, ankle } = this.size
    const reach = Math.sqrt(Math.max(0, leg ** 2 - (half + SLACK * leg) ** 2))
    const low = Math.min(left.y, right.y) - ankle
    return left.add(right).multiplyScalar(0.5).setY(Math.min(low + stand, low + ankle + reach))
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
    this.time = now
    if (dt <= 0) return
    const { size, hips, feet } = this
    if (this.course) {
      const course = this.course
      this.lead.place.copy(course.at(now)).setY(this.lead.place.y)
      this.lead.go(course.velocity(now), now)
      if (course.over(now)) this.course = undefined
    }
    const leap = this.jumping
    if (leap && now >= leap.lands + 0.2) {
      // landed, he comes to rest where his going carries him, as low as a hop or a dive had him
      this.jumping = undefined
      this.lead.place.copy(leap.place)
      // (his steps begin anew from where he landed)
      this.stepping = false
      for (const side of SIDES) delete this.steps[side]
      if (this.course === leap.course) this.course = new Course(size, now, leap.place, leap.velocity, leap.place.clone().addScaledVector(leap.velocity, leap.low === undefined ? leap.velocity.length() / (2 * PUSH.along) : 0), { speed: leap.velocity.length() + 0.1, push: PUSH.along, arrive: 0 })
      if (leap.low !== undefined) this.height = Math.min(this.height, leap.low)
    }
    const toes = Object.fromEntries(SIDES.filter((side) => !this.steps[side]).map((side) => [side, yawOf(feet[side].turn)]))
    const going = (this.going = this.lead.advance(dt, toes))
    const { leg, pace } = size
    this.rate = rate(size, going)
    this.duty = duty(size, going, 1 / this.rate)
    const swingShare = 1 - this.duty
    // the clock goes round while he goes, or a foot is out of place; it stops with both feet down where they belong
    const moving = !this.planted && (Math.abs(going.speed) > STILL * pace || Math.abs(going.aims) > TOGETHER)
    const strays = Object.fromEntries(SIDES.map((side) => [side, this.steps[side] ? Infinity : this.strays(side, going)])) as Record<Side, number>
    const away = Math.max(strays.left, strays.right)
    if (!this.stepping && !this.planted && (moving || away > TOGETHER * leg)) {
      this.stepping = true
      this.phase = (strays.left >= strays.right ? 0 : 0.5) - 1e-6
    }
    // (the strides come out even onto the planted foot: down as the hips come over it from behind)
    const plant = this.plant
    if (plant && this.stepping) {
      const lands = plant.at - (over(size, going.speed) * this.duty) / this.rate - now
      // (as many strides as come nearest his own at the speed he goes there on average)
      const mean = this.path(lands).distanceTo(this.lead.place) / Math.max(lands, 1e-3)
      if (lands > 0) this.rate = this.timed(lands, swingShare, rate(size, { ...going, speed: mean, faster: 0 }))
      else if (!this.steps[plant.side]) [this.plant, this.planted] = [undefined, this.course?.way.arrive === 0 ? plant.side : undefined]
    }
    const was = this.phase
    // (a foot down that its leg no longer reaches from where the hips are hurries the clock on to its share)
    const hips0 = hips.value.clone().setY(this.lead.place.y)
    const behind = !this.plant && !this.jumping && SIDES.some((side) => !this.steps[side] && this.holds(side, feet[side].value, hips0, going.facing) < hips.value.y)
    if (this.stepping) this.phase += this.rate * (behind ? CATCH : 1) * dt
    this.plan()
    const stance = this.stance()
    if (stance) {
      // (he keeps his stance: the other stands where it is, or is to; and stepping off it later, he goes on from between his feet)
      this.lead.place.set(stance.x, this.lead.place.y, stance.z)
      this.stepping = !!(this.steps.left || this.steps.right)
    }
    for (const side of SIDES) if (!stance || this.steps[side] || this.held(side)) this.tread(side, was, going, swingShare, moving, strays[side])
    // the ground he stands on is where his lowest foot down stands: up on what a story put him on, down again as he steps off it
    const lows = SIDES.filter((side) => !this.steps[side] && !this.feet[side].frames.length).map((side) => this.feet[side].value.y - size.ankle)
    if (lows.length && !this.jumping) this.lead.place.y = Math.min(...lows)
    if (this.stepping && !moving && !this.steps.left && !this.steps.right && away < TOGETHER * leg) this.stepping = false
    const down = Object.fromEntries(SIDES.map((side) => [side, { at: feet[side].value, down: !this.steps[side] }])) as Record<Side, { at: Vector3; down: boolean }>
    const speed = Math.hypot(hips.velocity.x, hips.velocity.z)
    const banks = Math.atan(Math.max(-0.5, Math.min(0.5, (going.speed * going.curves) / 9.81))) * Math.cos(going.facing - going.heading)
    const free = !this.stepping && !moving
    this.pelvis.advance(dt, hips.value, speed, 0, going.facing, banks, down, free)
  }

  /** the hips' frames, along where he will be, written anew from now */
  private plan() {
    const { hips, time: now } = this
    const theirs = hips.frames.find((frame) => frame.by !== 'gait')?.at ?? Infinity
    if (!hips.busy || hips.owner === 'gait' || theirs > now) {
      hips.cancel('gait')
      // (along a way he is sent, out to where it ends: the plan is where he will be)
      const ends = this.course ? Math.min(this.course.from + this.course.places.length / 60, now + FAR) : now + FAR / 2
      const along = Array.from({ length: Math.max(1, Math.ceil((ends - now - 0.7) / 0.3)) }, (_, k) => 1 + 0.3 * k)
      const marks = [...MARKS, ...along].filter((mark) => now + mark < theirs - 0.1)
      for (const mark of marks) {
        const { place, turn } = this.planned(mark)
        const later = this.planned(mark + 1e-3)
        const [velocity, spin] = [later.place.sub(place).divideScalar(1e-3), { x: 0, y: (later.turn - turn) / 1e-3, z: 0 }]
        // (and past the last of them it goes on along the ground)
        if (mark === marks.at(-1)) velocity.y = 0
        hips.by({ at: now + mark, place, velocity, turn: yaw(turn), spin, by: 'gait' })
      }
    }
  }

  /** a foot: it leaves the ground as its share of the stride begins, swings to its footfall, aimed anew, and comes down */
  private tread(side: Side, was: number, going: Going, swingShare: number, moving: boolean, strays: number) {
    const { size, feet, time: now } = this
    const foot = feet[side]
    // (a foot someone else has written frames to is theirs once its step would come down after theirs set off)
    // (a foot the story has from outside is theirs; and while it swings one, or puts one down, he stands on the other)
    const swung = this.held(other(side)) && this.feet[other(side)].velocity.distanceTo(this.hips.velocity) > SWUNG * this.size.pace
    if (foot.outside || ((swung || this.placing[other(side)]) && !this.steps[side])) {
      delete this.steps[side]
      return
    }
    const theirs = foot.frames.find((frame) => frame.by !== 'gait')
    // (a foot down that a story puts somewhere to stand steps there: lifted clear and swung, its footfall theirs)
    if (theirs?.place && !theirs.velocity && !theirs.on && theirs.by !== 'jump' && (this.placing[side] || !this.steps[side])) {
      const lands = this.placing[side]?.lands ?? theirs.at ?? now + PLACE * this.size.beat
      const pointed = yawOf(foot.turn)
      const step = (this.placing[side] ??= { side, from: foot.value.clone(), leaves: now, to: new Vector3(), lands, pointed, toes: theirs.turn ? yawOf(theirs.turn) : pointed })
      step.to.copy(theirs.place)
      delete this.steps[side]
      foot.cancel('gait')
      if (lands - now > 0.02) for (const frame of swing(size, step, now, 0, feet[side === 'left' ? 'right' : 'left'].value, this.going.facing).slice(0, -1)) foot.by(frame)
      return
    }
    delete this.placing[side]
    const sets = theirs ? (theirs.leaves ?? (theirs.at ?? now) - TAKES) : Infinity
    if ((this.steps[side]?.lands ?? now + (1 - this.duty) / this.rate) > sets) {
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
    Object.assign(step, { to, toes, lands: now + lands })
    foot.cancel('gait')
    for (const frame of swing(size, step, now, going.speed, feet[partner].value, going.facing)) foot.by(frame)
  }

  /**
   * the stride rate that has the planted foot come down in `left` s: on as many strides as come nearest his own, or one
   * more rather than one fewer, chosen once and kept while it stays near enough his own
   */
  private timed(left: number, swingShare: number, natural: number) {
    const plant = this.plant!
    // (it comes down at the end of its share of a stride: that stride is chosen once)
    const at = (stride: number) => stride + start(plant.side) + swingShare
    const rate = (at(plant.stride) - this.phase) / left
    if (rate > 0.6 * natural && rate < 1.6 * natural) return rate
    const next = Math.ceil(this.phase - start(plant.side) - swingShare)
    plant.stride = next + Math.max(0, Math.ceil(natural * left - (at(next) - this.phase) - 0.3))
    return Math.max(0, at(plant.stride) - this.phase) / left
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
    return { lead: this.lead.velocity.clone(), phase: this.phase, stepping: this.stepping, plant: this.plant && this.path(this.plant.at - this.time), feet, hips: this.hips.intent().path, facing: this.going.facing }
  }
}
