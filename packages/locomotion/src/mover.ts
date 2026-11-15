import { Vector3 } from 'three'
import type { Footing, Step } from './pelvis'
import { CADENCE, CLEAR, RIDE, SINK, STILL, sidle, STRIDE, TOGETHER, WALK, behind, lands, lunge, overhang, stride } from './gait'
import { toRest } from './pelvis'
import { both, clamp, damped, ease, EXACT, GRAVITY, ground, HEEL, other, raised, type Side, SIDES, SIGN, SLACK, SOLE, TRAIL, wrap } from '@drawcall/limbs'
import { type Placed, Steps, type Stride } from './steps'
import { Way } from './way'

/** how long a foot is in the air for a step at the least and at the most (in his beats) */
const AIR = { least: 0.5, most: 1.67 }
/** how much of the longest a foot is in the air it leaves the ground ahead of when the hips come to where it is to be down */
const EARLY = 0.7
/**
 * how far ahead of the hips a foot comes down: as far as they go in so long (in his beats), within so much of what a
 * leg reaches flat, which is also as far back as he shifts his weight over his feet without a step
 */
const FORE = { carries: 0.668, within: 0.9 }
/** how fast a foot in the air is brought back to where hips come to rest that were to go on further (in his paces) */
const SHIFT = 0.68
/** how much of its length a leg is at when he comes down on it out of the air, on the ball of its foot: the knee bent to give */
const LANDING = 0.92
/** how long before he comes down out of the air his feet reach for the ground (in his beats) */
const UNTUCK = AIR.least * 2
/** how much of their length the legs are drawn up by in the air */
const TUCK = 0.25
/** how far ahead of the hips or behind them a foot is carried through the air at the most (in lengths of his leg) */
const APART = 0.341
/** how many times a beat a foot off the ground comes round to point the way he faces */
const POINTS = 9
/** led, how near how high the legs reach the hips ride before they give to it (in lengths of his leg) */
const SOFT = 0.03
/** led, how long the hips take to come to how high his steps have them (in his beats) */
const HOLD = 0.5
/** how far round a foot swings at the most that steps as he turns where he stands (rad) */
const REACH = 1.4

/**
 * The hips and the feet under them, which is all of him that the ground moves. The feet that are the body's step under
 * the hips: one footfall a stride on from the last, each coming down as the hips come to where it is ahead of them by
 * as much as carries them over it, and further ahead the harder they are to be braked. A foot stays down until its leg,
 * the heel up, reaches it no longer. So he walks with both feet down between steps, runs with both in the air, and
 * comes to rest over his feet. It holds nothing else, so that a copy of it can be stepped on ahead to tell where he
 * will be.
 */
export class Mover extends Way {
  /** when a foot last came down */
  private trod = -Infinity
  /** how the feet step led, going his own way */
  private steps = new Steps(this.size)

  /** whether a leg reaches its foot where it stands from where the hips are: flat on the ground, or its heel up as far as brings the ankle, which turns about the ball of the foot, nearest the hip */
  reaches(side: Side, hips: Vector3) {
    const { ankle, leg, hip } = this.size
    const { at, toes } = this.foot[side]
    // how far ahead of its hip the foot is the way it points, and to the side of that: a heel comes up the way its foot points
    const [on, out] = [at.z - hips.z, at.x - SIGN[side] * hip]
    const [far, aside] = [on * Math.cos(toes) + out * Math.sin(toes), out * Math.cos(toes) - on * Math.sin(toes)]
    const [high, ball] = [hips.y - at.y, SOLE.ball * leg]
    const heel = raised(this.size, clamp(Math.atan2(high + ankle, far + ball) - Math.atan2(ankle, ball), 0, HEEL))
    return Math.hypot(Math.hypot(high - heel.y, far + heel.z), aside) <= leg
  }

  /** a copy to step on ahead */
  clone(): Mover {
    // (what is told along the way he is going is told anew as that turns: the copy has its own)
    const course = { ...this.course }
    const same = (sent?: typeof course) => (sent === this.course ? course : sent)
    return Object.assign(new Mover(this.size, this.stoops), this, {
      value: this.value.clone(),
      velocity: this.velocity.clone(),
      acceleration: this.acceleration.clone(),
      origin: this.origin.clone(),
      course,
      stance: same(this.stance),
      planted: same(this.planted),
      plant: this.plant && { ...this.plant },
      steps: this.steps.clone(),
      spring: this.spring && { ...this.spring, top: this.spring.top.clone() },
      foot: both((side) => {
        const { at, step, put } = this.foot[side]
        return {
          ...this.foot[side],
          at: at.clone(),
          step: step && { ...step, from: step.from.clone(), to: step.to.clone() },
          put: put?.clone(),
        }
      }),
    })
  }

  /** whether he stands: at rest where he was to, on both feet, side by side under him and pointing the way he faces */
  get stands() {
    return this.halted && this.together && SIDES.every((side) => this.strays(side) <= TOGETHER * this.size.leg)
  }

  /**
   * The story puts a foot down at a place on the ground or on a thing, or with none, has it there no longer. He steps
   * there with it, one foot at a time, in so many `seconds` or as soon as he can, and stands over his feet: the hips
   * come to rest between them, as high as his legs reach both from there.
   */
  put(side: Side, at?: Vector3, seconds?: number) {
    const [foot, partner] = [this.foot[side], this.foot[other(side)]]
    foot.put = foot.due = undefined
    this.planted = undefined
    const place = at && this.local(at.clone(), side)
    if (!place) {
      // with no foot put anywhere any more, how high the hips stand is the body's again
      if (!this.placed && this.course === this.stance) this.course = { ...this.course, y: this.height }
      return
    }
    // (no further from the other than his legs span)
    const stands = partner.step?.to ?? partner.at
    const span = this.span(lunge(this.size))
    place.z = clamp(place.z, stands.z - 2 * span, stands.z + 2 * span)
    // (the other stands where it is, or is to: the two are his stance)
    partner.put ??= stands.clone()
    foot.put = place
    if (seconds !== undefined) foot.due = this.time + seconds
    this.settle(this.led)
  }

  /**
   * he comes to rest between his feet, as they stand or are to, and stands over them: as high as legs reach feet that
   * are so far apart, by what he may be off, a foot coming down where its leg reaches it
   */
  settle(led: boolean) {
    const [left, right] = SIDES.map((side) => this.foot[side].put ?? this.foot[side].step?.to ?? this.foot[side].at)
    const half = Math.abs(left.z - right.z) / 2
    const { leg, pace } = this.size
    const y = Math.min(left.y, right.y) + Math.sqrt(Math.max(0, leg ** 2 - (half + SLACK.reach * leg) ** 2))
    const z = this.between().z
    const puts = SIDES.map((side) => this.foot[side].put)
    this.send(toRest(y, z, (Math.sign(z - this.value.z) || 1) * WALK.speed * pace), led)
    ;[this.foot.left.put, this.foot.right.put] = puts
    this.stance = this.course
  }

  /** how far along the way he is going a foot comes down at the most: where the hips come to rest, if they are to, once that is on his way */
  private get furthest() {
    const { course, halt, value, way } = this
    if (halt === undefined || this.veers) return Infinity
    // (standing low, his feet are that much ahead of the hips)
    return Math.max((halt + behind(this.size, course.y - this.low)) * way, value.z * way)
  }

  /** sidestepping: whether the hip of a side is the one ahead, the way he is going */
  private leads(side: Side) {
    return SIGN[side] * Math.sin(this.faces) * this.way < 0
  }

  /** how far on in his turning a foot that steps as he turns where he stands is put, and points: no further round from how it stands than a foot swings (rad) */
  private around(side: Side) {
    const points = this.foot[side].toes - this.faces
    return this.halted || this.rounds === 0 ? clamp(this.aims, points - REACH, points + REACH) : 0
  }

  /** how far from under the hips a leg reaches the ground, its foot flat, when they are this high (m) */
  private span(hips: number) {
    const height = hips - this.size.ankle
    return Math.sqrt(Math.max(0, this.size.leg ** 2 - height * height))
  }

  advance(dt: number) {
    this.carried(dt)
    this.time += dt
    // (the way he is to face turns on as it turns, until he is told it anew)
    if (this.face !== undefined) this.face = wrap(this.face + this.swings * dt)
    this.idles(dt)
    // (led, with his feet his own, he steps by the clock of his strides: else as he goes where he is sent)
    if (this.led && !this.placed && !this.jumps) {
      this.stride(dt)
      return
    }
    this.steps.resting = true
    const down = SIDES.some((side) => this.foot[side].down)
    this.steer(dt, down)
    const { x } = this.value
    this.move(dt, down)
    // (in the air he flies across the way he is going as he left the ground: the way goes with him)
    if (this.aloft) this.across(this.value.x - x)
    else this.sway(dt, x)
    for (const side of SIDES) this.tread(side, dt)
    this.level()
    // at a run the last foot to leave the ground pushes him up as it goes: as fast as has him back as high when the next comes down
    const feet = SIDES.map((side) => this.foot[side])
    const air = Math.min(...feet.map((foot) => foot.step?.remains ?? Infinity))
    const leaves = down && !feet.some((foot) => foot.down) && !this.aloft && !this.drops && air < Infinity
    if (leaves && Math.abs(this.velocity.z) > WALK.most * this.size.pace) {
      this.velocity.y = (GRAVITY * air) / 2
      this.bounds = true
    }
    this.lower(dt)
    this.swivel(dt, this.banks)
  }

  /**
   * Led, a step of time: the way he goes and faces follows the world, the feet step after the hips by the clock of
   * his strides, and the hips go as fast as he is led, as high as his feet let them, rising and falling with each step.
   */
  private stride(dt: number) {
    const { value, velocity, foot, size, course } = this
    this.follow(dt)
    // (speeding up as he is led to, along the way he goes, forwards or back)
    const faster = Math.sign(velocity.z) * (course.faster ?? 0)
    // the steps are told in the scene, where the feet stand still however the way he is going turns
    const feet = both((side): Placed => {
      const { at, toes, down } = foot[side]
      const [held, reached] = [this.has(foot[side], dt), this.reaches(side, value)]
      return { at: this.scene(at.clone(), side), toes: this.heading + toes, down, held, reached }
    })
    const { heading, curves, facing, spins, aims } = this
    const at = this.scene(new Vector3(0, 0, value.z))
    const stride = this.steps.advance({ at, speed: velocity.z, faster, heading, curves, facing, spins, aims }, feet, dt)
    for (const side of SIDES) {
      const [footing, placed] = [foot[side], feet[side]]
      this.local(placed.at, side, footing.at)
      footing.toes = placed.toes - this.heading
      footing.down = placed.down
      if (placed.down) footing.stood = this.time
      const { to, remains } = placed
      footing.step = to && remains !== undefined ? { from: footing.at.clone(), to: this.local(to.clone(), side), through: 0, remains } : undefined
    }
    this.acceleration.set(0, 0, 0)
    value.z += velocity.z * dt
    this.ride(dt, stride)
    this.bounds = false
    // (no further than over the foot as it stands under its hip: one put out for him to lean into a turn he leans over)
    this.sway(dt, value.x, size.hip)
    this.lower(dt)
    this.swivel(dt, this.banks)
  }

  /**
   * Led, the hips ride as high as they are held, lower going along, and rise and fall with each step; no higher than
   * his legs reach his feet, the one easing into the other, a foot in the air as where it comes down from where the
   * hips are by then, so he flies no higher than he lands.
   */
  private ride(dt: number, { phase, dip, bob }: Stride) {
    const { value, velocity, foot, size, course } = this
    // (held lower than he stands, he rides no lower for his stride than that)
    const ride = course.y - this.low - Math.max(0, dip - (size.stand - course.y)) + bob * Math.cos(4 * Math.PI * phase)
    const lands = ({ at, step }: Footing) => (step ? step.to.clone().setZ(step.to.z - velocity.z * step.remains) : at)
    const reach = this.ceiling(value.z, SIDES, (side) => lands(foot[side])) - ride
    const soft = SOFT * size.leg
    const eased = ride + Math.min(0, reach) - soft * Math.log1p(Math.exp(-Math.abs(reach) / soft))
    const high = clamp(eased, this.deepest, size.stand)
    const rose = velocity.y
    // (they come down no faster than he sinks, as a stoop is planned)
    velocity.y = Math.max(-SINK * size.pace, damped(velocity.y, high - value.y, (2 * Math.PI) / (HOLD * size.beat), dt))
    this.acceleration.y = (velocity.y - rose) / dt
    value.y += velocity.y * dt
  }


  /**
   * how far ahead of the hips a foot comes down: by what carries them over it, and by where the push has to come from.
   * Sidestepping, the foot that steps out half a step, and the other, closing up, under him
   */
  private fore(side: Side) {
    const { value, velocity } = this
    const { leg, beat } = this.size
    if (this.sidles) return this.leads(side) ? (sidle(Math.abs(velocity.z) / this.size.pace) * leg) / 2 : 0
    // (and further ahead the harder it is to brake him: never behind him)
    const brakes = -(value.y / GRAVITY) * this.wanted * this.way
    // (within what a leg reaches, short of its stretch, from as high as the hips ride as a foot comes down)
    return clamp(
      FORE.carries * beat * Math.abs(velocity.z) + brakes,
      0,
      FORE.within * this.span(this.rides - this.low - RIDE * leg),
    )
  }

  /** how long the hips take to come to where a foot that comes down at a place along z is so far ahead of them (s) */
  private comes(z: number, ahead: number) {
    return ((z - this.value.z) * this.way - ahead) / Math.max(Math.abs(this.velocity.z), STILL * this.size.pace)
  }

  /** a foot in the air is no lower than it stands, and trails no further behind him than a hip lets a leg */
  private trail(foot: Footing) {
    foot.at.y = Math.max(foot.at.y, this.size.ankle)
    foot.at.z = Math.max(foot.at.z, this.value.z - (this.value.y - foot.at.y) * Math.tan(TRAIL))
  }

  /** a foot of the body's: it stays down while its leg reaches it, and steps when it is its turn */
  private tread(side: Side, dt: number) {
    const foot = this.foot[side]
    if (foot.down) foot.stood = this.time
    else {
      const points = foot.step?.points === undefined ? this.faces : foot.step.points - this.heading
      foot.toes += (points - foot.toes) * Math.min(1, (POINTS * dt) / this.size.beat)
    }
    if (this.has(foot, dt)) {
      foot.step = undefined
      foot.down = false
      return
    }
    if (this.falls) {
      foot.step = undefined
      this.hang(foot, side, dt)
      return
    }
    foot.fore = undefined
    if (foot.down) {
      const to = this.placed || this.reaches(side, this.value) ? this.next(side) : this.place(side)
      if (!to) return
      foot.down = false
      if (!this.launch) foot.step = this.start(side, to)
    }
    if (this.launch && !foot.step) {
      // off the ground in a push it goes with him: but for the one on its way down to push him off
      foot.at.addScaledVector(this.velocity, dt)
      this.trail(foot)
      return
    }
    const step = (foot.step ??= this.start(side, foot.put ?? this.place(side)))
    const { halt, way } = this
    const { ankle, leg, beat, pace } = this.size
    // it comes down as the hips come to where it is to be ahead of them, as far as it will stand ahead of them where
    // the story has put it: no sooner after the last footfall than feet step, nor sooner than a foot gets through the air
    const soonest = Math.max(this.trod + CADENCE * beat - this.time, AIR.least * beat * (1 - step.through))
    const fore = this.fore(side)
    const [going, most] = [Math.max(Math.abs(this.velocity.z), STILL * pace), AIR.most * beat * (1 - step.through)]
    const reaches = (z: number) => Math.hypot(this.value.y - ankle, z - this.value.z) <= leg
    // (led a way, how fast he goes is the world's, which a step set off before did not foresee: it comes down under
    // the hips at the least, and where they will be by the time a foot is down at the latest, as far ahead of them as
    // it is to be)
    if (this.course.heading !== undefined && !foot.put) {
      if (this.comes(step.to.z, 0) < soonest) step.to.z = this.value.z + way * soonest * going
      else if (this.comes(step.to.z, fore) > most && !reaches(step.to.z))
        step.to.z = this.value.z + way * (most * going + fore)
    }
    // (led along, a foot steps its stance along as fast as feet step)
    const along = foot.put && halt === undefined && this.led
    const hips = along ? 0 : this.comes(step.to.z, foot.put && halt !== undefined ? (step.to.z - halt) * way : fore)
    // no further on than where the hips now come to rest: nor, led slower, to a walk, than his leg reaches
    const within = this.led && !this.bounds ? this.value.z * way + leg : Infinity
    const on = foot.put ? step.to.z : Math.min(step.to.z * way, this.furthest, within) * way
    step.to.z += clamp(on - step.to.z, -SHIFT * pace * dt, SHIFT * pace * dt)
    // and where its leg reaches it, no later than a foot stays in the air
    const latest = reaches(step.to.z) ? Math.max(soonest, most) : Infinity
    // (put down by a moment, it is there then, or as soon after as a foot gets through the air)
    const due = foot.put && foot.due !== undefined ? Math.max(foot.due - this.time, AIR.least * beat * (1 - step.through)) : undefined
    const remains = (step.remains = due ?? clamp(hips, soonest, latest))
    if (remains <= dt) {
      foot.at.copy(step.to)
      foot.down = true
      foot.step = undefined
      this.trod = this.time
      return
    }
    step.through += ((1 - step.through) * dt) / remains
    const high = (CLEAR.least + (CLEAR.faster * Math.abs(this.velocity.z)) / pace) * leg
    foot.at.lerpVectors(step.from, step.to, ease(step.through))
    // (and over what it steps up onto or down from)
    foot.at.y += (high + Math.abs(step.to.y - step.from.y) / 2) * Math.sin(Math.PI * step.through)
    this.trail(foot)
    const far = Math.hypot(this.value.y - foot.at.y, foot.at.z - this.value.z)
    if (far > leg) foot.at.lerp(new Vector3(foot.at.x, this.value.y, this.value.z), 1 - leg / far)
  }

  /** where a foot on the ground steps to now, if it is to leave it: the rear one, in time to be down again where it is to */
  private next(side: Side) {
    const [foot, partner] = [this.foot[side], this.foot[other(side)]]
    const together = TOGETHER * this.size.leg
    if (this.launch || !partner.down) return undefined
    // where the story has put a foot it steps to, and from there neither steps: led, the one further from where it is to
    // be first, of two as far the one ahead the way he goes, so his feet never cross
    const off = ({ at, put }: Footing) => (put ? at.distanceTo(put) : 0)
    const leads = (partner.put?.z ?? partner.at.z) * this.way < (foot.put?.z ?? foot.at.z) * this.way
    const sooner = off(foot) > off(partner) + EXACT || (off(foot) > off(partner) - EXACT && leads)
    if (foot.put && off(foot) > 0 && sooner) return foot.put
    if (this.placed || this.planted === this.course) return undefined
    const lags = (partner.at.z - foot.at.z) * this.way
    if (this.halted || this.rounds === 0) {
      // at rest he stands with his feet together under him, pointing the way he faces: turning where he stands, the foot he has turned further from steps on round, to where it stands when he has turned on, in the scene
      const [ahead, off] = [this.around(side), this.strays(side, this.around(side))]
      const apart = (ahead === 0 && Math.abs(lags) > together) || off > together
      if (!apart || off < this.strays(other(side), this.around(other(side)))) return undefined
      const to = this.halted ? this.place(side) : ground(this.size, side, this.value.z)
      return to.add(this.turned(side, this.faces + ahead))
    }
    // the foot behind steps, and of two side by side the left: sidestepping, the one whose hip is ahead steps out, and the other up to it
    const level = this.sidles ? together : 0
    const first = this.sidles ? this.leads(side) : side === 'left'
    if (this.squats || lags < -level || (Math.abs(lags) <= level && !first)) return undefined
    // he shifts his weight over his feet without a step: as far on as his ankles bend, and as far back as his legs reach
    const { course } = this
    const shift = this.halt === undefined || this.veers ? undefined : this.halt - this.back
    const [rear, front] = [Math.min(foot.at.z, partner.at.z), Math.max(foot.at.z, partner.at.z)]
    const near = FORE.within * this.span(Math.min(course.y, this.value.y))
    if (shift !== undefined && shift <= rear + Math.max(overhang(this.size, course.y), 0) && shift >= front - near)
      return undefined
    const to = this.place(side)
    // out of a stand he steps off at once; going, in time for the foot to be down as the hips come
    const stands = Math.abs(lags) < together
    const timely = stands || this.comes(to.z, this.fore(side)) <= EARLY * AIR.most * this.size.beat
    return timely && Math.abs(to.z - foot.at.z) > together ? to : undefined
  }

  private start(side: Side, to: Vector3): Step {
    // the footfall that was to be is on its way
    if (to.z === this.plant?.at) [this.plant, this.planted] = [undefined, this.course]
    const from = this.foot[side].at.clone()
    const ahead = this.around(side)
    const points = ahead ? this.facing + ahead : undefined
    return { from, to, through: 0, remains: AIR.least * this.size.beat, points }
  }

  /** where a foot comes down next: a stride on from the last footfall, the strides coming out even onto a footfall that is to be */
  private place(side: Side) {
    const { value, way } = this
    // (the strides come out onto a footfall once it is on the way he is going)
    let plant = this.veers ? undefined : this.plant
    const feet = SIDES.map((each) => this.foot[each])
    const { leg, pace } = this.size
    const going = Math.abs(this.velocity.z)
    // (how many paces he goes, or braked onto a footfall that is to be, will go on the way there)
    const fast = (plant && this.wanted * way < 0 ? (going + this.course.arrive) / 2 : going) / pace
    // his stride as fast as he goes. From standing with the feet together the first step is part of one: and at a run it is as far as a leg, as long as it is, holds the ground, and as far as he flies
    let far = stride(this.size, fast) * (this.together ? STRIDE.first : 1)
    if (fast > WALK.most) far = (1 + STRIDE.flown * fast) * leg
    // sideways he steps out as far as he does, and backwards no further than his legs reach flat: a heel comes up only behind him
    if (this.sidles) far = sidle(going / pace) * leg
    else if (way < 0) far = Math.min(far, FORE.within * (this.fore(side) + this.span(value.y)))
    // the last footfall: the furthest one made or on its way, or with no foot down or coming down, where the hips are
    const last = Math.max(
      value.z * way - far,
      ...feet.filter(({ step, down }) => step || down).map(({ step, at }) => (step?.to.z ?? at.z) * way),
    )
    // (sidestepping, the foot whose hip is behind steps up to the other, and not past it)
    let on = this.sidles && !this.leads(side) ? last : last + far
    // (one his feet are past already is none)
    if (plant && plant.at * way <= last) this.plant = plant = undefined
    if (plant) {
      const togo = plant.at * way - last
      // as many strides as come nearest to his own, the last of them the foot's that is to be planted
      let count = Math.max(1, Math.round(togo / far))
      const mine = (strides: number) => !plant.side || (strides % 2 === 1) === (side === plant.side)
      // (one more, unless his feet have not the time for strides so short: then one fewer)
      if (!mine(count)) count += count === 1 || togo / (count + 1) >= CADENCE * fast * leg ? 1 : -1
      far = togo / count
      on = count === 1 ? plant.at * way : last + far
    }
    return ground(this.size, side, Math.min(on, this.furthest) * way)
  }

  /** in the air a foot is drawn up under the hips, and reaches for the ground where he comes down, ball first: as far ahead of the hips as he takes to come to rest, if his legs reach that */
  private hang(foot: Footing, side: Side, dt: number) {
    const { value, velocity } = this
    const { ankle, leg, beat, hip } = this.size
    const aside = SIGN[side] * hip
    if (foot.down) {
      if (this.reaches(side, value)) return
      foot.down = false
    }
    // through the air the legs stay as far apart as they left the ground, drawn up under him
    foot.fore ??= clamp(foot.at.z - value.z, -APART * leg, APART * leg)
    const split = (foot.fore - (this.foot[other(side)].fore ?? foot.fore)) / 2
    const ball = raised(this.size, HEEL)
    const touch = ankle + ball.y + LANDING * leg
    const drop = velocity.y * velocity.y + 2 * GRAVITY * (value.y - touch)
    const air = drop > 0 ? (velocity.y + Math.sqrt(drop)) / GRAVITY : 0
    const forth = leg * Math.sqrt(1 - LANDING * LANDING)
    const brakes = clamp(lands(this.size, velocity.z), -forth, forth - ball.z)
    // sent on, he comes down on the foot that has been off the ground for longer, and the other steps on from there
    const waits = this.sent && foot.stood > this.foot[other(side)].stood && !this.has(this.foot[other(side)], dt)
    const tucked = air > UNTUCK * beat || waits
    // (reaching for the ground, it is ahead of the hips by as much as it lands ahead of them, the leg stretching from
    // drawn up to as long as it lands, as they come down)
    const drawn = Math.min(1, air / (UNTUCK * beat))
    const to = tucked
      ? new Vector3(aside, value.y - (1 - TUCK) * leg, value.z + TUCK * leg * this.way + split)
      : new Vector3(
          aside,
          Math.max(ankle + ball.y, value.y - (LANDING - TUCK * drawn) * leg),
          value.z + brakes + ball.z + split * drawn,
        )
    if (air <= dt && !waits) {
      // (the ground holds it where it stands once its heel is down)
      foot.at.set(to.x, ankle, to.z - ball.z)
      foot.down = true
      this.trod = this.time
      return
    }
    // it goes with him, and to where it is to be as fast as gets it there in time: no faster than a leg is drawn up
    foot.at.addScaledVector(velocity, dt).lerp(to, Math.min(1, dt / Math.max(tucked ? AIR.least * beat : air, dt)))
    foot.at.x = aside
  }
}
