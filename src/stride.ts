import { Vector3 } from 'three'
import type { Footing, Step } from './hips'
import { Hips, LUNGE, PUSH, RIDE, STILL, TOGETHER, WALK, behind, lands, overhang } from './hips'
import { TRAIL } from './joints'
import { SLACK } from './limb'
import { HEEL, LEG, SIDES, SIGN, SIZE, STAND, type Side, both, other, raised } from './size'
import { GRAVITY, clamp, ease } from './world'

/** how far a step carries him standing and how much further for every m/s he goes (m), and how much of that the first step out of a stand carries him; and how long he is in the air between the strides of a run (s) */
const STRIDE = { least: 0.5, faster: 0.17, first: 0.5, flown: 0.13 }
/** how long a foot is in the air for a step at the least and at the most (s) */
const AIR = { least: 0.15, most: 0.5 }
/** the least between two footfalls (s) */
const CADENCE = 0.2
/** how much of the longest a foot is in the air it leaves the ground ahead of when the hips come to where it is to be down */
const EARLY = 0.7
/** how far ahead of the hips a foot comes down: as far as they go in so long (s), within so much of what a leg reaches flat, which is also as far back as he shifts his weight over his feet without a step */
const FORE = { carries: 0.2, within: 0.9 }
/** how fast a foot in the air is brought back to where hips come to rest that were to go on further (m/s) */
const SHIFT = 2
/** how high a foot is lifted in a step, and how much higher for every m/s he goes (m): the heel kicks up behind him, as far as a knee folds */
const CLEAR = { least: 0.04, faster: 0.04 }
/** how much of its length a leg is at when he comes down on it out of the air, on the ball of its foot: the knee bent to give */
const LANDING = 0.92
/** how long before he comes down out of the air his feet reach for the ground (s) */
const UNTUCK = AIR.least * 2
/** how much of their length the legs are drawn up by in the air */
const TUCK = 0.25
/** how far ahead of the hips or behind them a foot is carried through the air at the most (m) */
const APART = 0.3

/** how far to its side a foot stands (m) */
const aside = (side: Side) => SIGN[side] * SIZE.hip

/** whether a leg reaches a foot where it stands from where the hips are: flat on the ground, or behind him, up on its ball */
export function reaches(foot: Vector3, hips: Vector3) {
  const [far, high] = [foot.z - hips.z, hips.y - SIZE.ankle]
  const heel = raised(HEEL)
  return Math.hypot(high, far) <= LEG || Math.hypot(high - heel.y, far + heel.z) <= LEG
}

/**
 * The hips and the feet under them, which is all of him that the ground moves. The feet that are the body's step
 * under the hips: one footfall a stride on from the last, each coming down as the hips come to where it is ahead of
 * them by as much as carries them over it, and further ahead the harder they are to be braked. A foot stays down
 * until its leg, the heel up, reaches it no longer. So he walks with both feet down between steps, runs with both
 * in the air, and comes to rest over his feet. It holds nothing else, so that a copy of it can be stepped on ahead
 * to tell where he will be.
 */
export class Mover extends Hips {
  /** when a foot last came down */
  private trod = -Infinity

  /** a copy to step on ahead */
  clone(): Mover {
    return Object.assign(new Mover(this.stoops), this, {
      value: this.value.clone(),
      velocity: this.velocity.clone(),
      acceleration: this.acceleration.clone(),
      spring: this.spring && { ...this.spring },
      foot: both((side) => {
        const { at, step } = this.foot[side]
        return {
          ...this.foot[side],
          at: at.clone(),
          step: step && { ...step, from: step.from.clone(), to: step.to.clone() },
        }
      }),
    })
  }

  /** whether he stands: at rest where he was to, on both feet, side by side under him */
  get stands() {
    return this.rests && this.together && Math.abs(this.foot.left.at.z - this.value.z - this.back) <= TOGETHER
  }

  /**
   * The story puts a foot down at a place on the ground, or with none, has it there no longer. He steps there with
   * it, one foot at a time, and stands over his feet: the hips come to rest between them, as high as his legs reach
   * both from there.
   */
  put(side: Side, place?: Vector3) {
    const [foot, partner] = [this.foot[side], this.foot[other(side)]]
    foot.put = undefined
    this.planted = undefined
    if (!place) {
      // with no foot put anywhere any more, how high the hips stand is the body's again
      if (!this.placed && this.course === this.stance) this.course = { ...this.course, y: STAND }
      return
    }
    if (partner.put && !partner.at.equals(partner.put)) {
      throw new Error(
        `the ${side} foot is sent to step somewhere, and the ${other(side)} foot is on its way to where it was sent: wait for that`,
      )
    }
    const stands = partner.step?.to ?? partner.at
    const half = Math.abs(place.z - stands.z) / 2
    if (half > this.span(LUNGE)) {
      throw new Error(
        `the ${side} foot is sent to stand ${(2 * half).toFixed(2)} m from the ${other(side)}, and his legs span ${(2 * this.span(LUNGE)).toFixed(2)} m`,
      )
    }
    const z = (place.z + stands.z) / 2
    // (as high as legs reach feet that are further apart by what he may be off: a foot comes down where its leg reaches it)
    const y = SIZE.ankle + Math.sqrt(LEG * LEG - (half + SLACK.reach) ** 2)
    this.send({ z, y, speed: (Math.sign(z - this.value.z) || 1) * WALK.speed, push: PUSH.along, arrive: 0 })
    this.stance = this.course
    foot.put = place
  }

  /** which way he is going along z: or is about to */
  private get way() {
    const { course, value, velocity } = this
    if (Math.abs(velocity.z) > STILL) return Math.sign(velocity.z)
    return Math.sign(course.z === undefined ? course.speed : course.z - value.z) || 1
  }

  /** how far along the way he is going a foot comes down at the most: where the hips come to rest, if they are to */
  private get furthest() {
    const { course, halt, value, way } = this
    if (halt === undefined) return Infinity
    // (standing low, his feet are that much ahead of the hips)
    return Math.max((halt + behind(course.y - this.low)) * way, value.z * way)
  }

  /** how far from under the hips a leg reaches the ground, its foot flat, when they are this high (m) */
  private span(hips: number) {
    const height = hips - SIZE.ankle
    return Math.sqrt(Math.max(0, LEG * LEG - height * height))
  }

  /** time goes on by a step */
  advance(dt: number) {
    this.time += dt
    const down = SIDES.some((side) => this.foot[side].down)
    const { x } = this.value
    this.move(dt, down)
    this.sway(dt, x)
    for (const side of SIDES) this.tread(side, dt)
    // at a run the last foot to leave the ground pushes him up as it goes: as fast as has him back as high when the next comes down
    const feet = SIDES.map((side) => this.foot[side])
    const air = Math.min(...feet.map((foot) => foot.step?.remains ?? Infinity))
    const leaves = down && !feet.some((foot) => foot.down) && !this.aloft && !this.drops && air < Infinity
    if (leaves && Math.abs(this.velocity.z) > WALK.most) {
      this.velocity.y = (GRAVITY * air) / 2
      this.bounds = true
    }
    this.lower(dt)
    this.swivel(dt)
  }

  /** how far ahead of the hips a foot comes down: by what carries them over it, and by where the push has to come from */
  private get lead() {
    const { value, velocity } = this
    // (and further ahead the harder it is to brake him: never behind him)
    const brakes = -(value.y / GRAVITY) * this.wanted * this.way
    // (within what a leg reaches, short of its stretch, from as high as the hips ride as a foot comes down)
    return clamp(
      FORE.carries * Math.abs(velocity.z) + brakes,
      0,
      FORE.within * this.span(this.course.y - this.low - RIDE),
    )
  }

  /** how long the hips take to come to where a foot that comes down at a place along z is so far ahead of them (s) */
  private comes(z: number, ahead = this.lead) {
    return ((z - this.value.z) * this.way - ahead) / Math.max(Math.abs(this.velocity.z), STILL)
  }

  /** a foot in the air is no lower than it stands, and trails no further behind him than a hip lets a leg */
  private trail(foot: Footing) {
    foot.at.y = Math.max(foot.at.y, SIZE.ankle)
    foot.at.z = Math.max(foot.at.z, this.value.z - (this.value.y - foot.at.y) * Math.tan(TRAIL))
  }

  /** a foot of the body's: it stays down while its leg reaches it, and steps when it is its turn */
  private tread(side: Side, dt: number) {
    const foot = this.foot[side]
    if (foot.down) foot.stood = this.time
    if (this.has(foot, dt)) {
      foot.step = undefined
      foot.down = false
      return
    }
    if (this.falls) {
      // (the step it was making is off)
      foot.step = undefined
      this.hang(foot, side, dt)
      return
    }
    foot.fore = undefined
    if (foot.down) {
      const to = this.placed || reaches(foot.at, this.value) ? this.next(side) : this.place(side)
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
    // it comes down as the hips come to where it is to be ahead of them, as far as it will stand ahead of them where
    // the story has put it: no sooner after the last footfall than feet step, nor sooner than a foot gets through the air
    const hips = this.comes(step.to.z, foot.put && halt !== undefined ? (step.to.z - halt) * way : undefined)
    const soonest = Math.max(this.trod + CADENCE - this.time, AIR.least * (1 - step.through))
    // no further on than where the hips now come to rest
    const on = foot.put ? step.to.z : Math.min(step.to.z * way, this.furthest) * way
    step.to.z += clamp(on - step.to.z, -SHIFT * dt, SHIFT * dt)
    // and where its leg reaches it, no later than a foot stays in the air
    const reached = Math.hypot(this.value.y - SIZE.ankle, step.to.z - this.value.z) <= LEG
    const latest = reached ? Math.max(soonest, AIR.most * (1 - step.through)) : Infinity
    const remains = (step.remains = clamp(hips, soonest, latest))
    if (remains <= dt) {
      foot.at.copy(step.to)
      foot.down = true
      foot.step = undefined
      this.trod = this.time
      return
    }
    step.through += ((1 - step.through) * dt) / remains
    const high = CLEAR.least + CLEAR.faster * Math.abs(this.velocity.z)
    foot.at.lerpVectors(step.from, step.to, ease(step.through))
    foot.at.y += high * Math.sin(Math.PI * step.through)
    // it is no further from the hips than the leg is long
    this.trail(foot)
    const far = Math.hypot(this.value.y - foot.at.y, foot.at.z - this.value.z)
    if (far > LEG) foot.at.lerp(new Vector3(foot.at.x, this.value.y, this.value.z), 1 - LEG / far)
  }

  /** where a foot on the ground steps to now, if it is to leave it: the rear one, in time to be down again where it is to */
  private next(side: Side) {
    const [foot, partner] = [this.foot[side], this.foot[other(side)]]
    if (this.launch || !partner.down) return undefined
    // where the story has put a foot it steps to, and from there neither steps
    if (foot.put && !foot.at.equals(foot.put)) return foot.put
    if (this.placed || this.planted === this.course) return undefined
    // how far behind the other this one is, the way he is going
    const lags = (partner.at.z - foot.at.z) * this.way
    if (this.rests) {
      // at rest he stands with his feet together under him
      const off = Math.abs(foot.at.z - this.value.z - this.back)
      const apart = Math.abs(lags) > TOGETHER || off > TOGETHER
      return apart && off >= Math.abs(partner.at.z - this.value.z - this.back) ? this.place(side) : undefined
    }
    // (standing lower than he is to go along, he comes up before he steps along)
    if (this.squats || lags < 0 || (lags === 0 && side === 'right')) return undefined
    // he shifts his weight over his feet without a step: as far on as his ankles bend, and as far back as his legs reach
    const { course } = this
    const shift = this.halt === undefined ? undefined : this.halt - this.back
    const [rear, front] = [Math.min(foot.at.z, partner.at.z), Math.max(foot.at.z, partner.at.z)]
    const near = FORE.within * this.span(Math.min(course.y, this.value.y))
    if (shift !== undefined && shift <= rear + Math.max(overhang(course.y), 0) && shift >= front - near)
      return undefined
    const to = this.place(side)
    // out of a stand he steps off at once; going, in time for the foot to be down as the hips come
    const stands = Math.abs(lags) < TOGETHER
    const timely = stands || this.comes(to.z) <= EARLY * AIR.most
    return timely && Math.abs(to.z - foot.at.z) > TOGETHER ? to : undefined
  }

  /** the step a foot makes to a place */
  private start(side: Side, to: Vector3): Step {
    // the footfall that was to be is on its way
    if (to.z === this.plant?.at) [this.plant, this.planted] = [undefined, this.course]
    const from = this.foot[side].at.clone()
    // (a foot his leg reaches only up on its ball leaves the ground from there)
    const heel = raised(HEEL)
    if (Math.hypot(this.value.y - from.y, from.z - this.value.z) > LEG)
      from.set(from.x, from.y + heel.y, from.z + heel.z)
    return { from, to, through: 0, remains: AIR.least }
  }

  /** where a foot comes down next: a stride on from the last footfall, the strides coming out even onto a footfall that is to be */
  private place(side: Side) {
    const { value, plant, way } = this
    const feet = SIDES.map((each) => this.foot[each])
    const going = Math.abs(this.velocity.z)
    const pace = plant && this.wanted * way < 0 ? (going + this.course.arrive) / 2 : going
    // his stride at the pace he goes, or braked onto a footfall that is to be, will go on the way there. From standing with the feet together the first step is part of one: and at a run it is as far as a leg, as long as it is, holds the ground, and as far as he flies
    let far = (STRIDE.least + STRIDE.faster * pace) * (this.together ? STRIDE.first : 1)
    if (pace > WALK.most) far = LEG + STRIDE.flown * pace
    // backwards he steps no further than his legs reach flat: a heel comes up only behind him
    if (way < 0) far = Math.min(far, FORE.within * (this.lead + this.span(value.y)))
    // the last footfall: the furthest one made or on its way, or with no foot down or coming down, where the hips are
    const last = Math.max(
      value.z * way - far,
      ...feet.filter(({ step, down }) => step || down).map(({ step, at }) => (step?.to.z ?? at.z) * way),
    )
    let on = last + far
    if (plant) {
      const togo = plant.at * way - last
      if (togo <= 0) throw new Error(`a foot is to be planted at ${plant.at.toFixed(2)} m, and his feet are past it`)
      // as many strides as come nearest to his own, the last of them the foot's that is to be planted
      let count = Math.max(1, Math.round(togo / far))
      const mine = (strides: number) => !plant.side || (strides % 2 === 1) === (side === plant.side)
      // (one more, unless his feet have not the time for strides so short: then one fewer)
      if (!mine(count)) count += count === 1 || togo / (count + 1) >= CADENCE * pace ? 1 : -1
      far = togo / count
      on = count === 1 ? plant.at * way : last + far
    }
    return new Vector3(aside(side), SIZE.ankle, Math.min(on, this.furthest) * way)
  }

  /** in the air a foot is drawn up under the hips, and reaches for the ground where he comes down, ball first: as far ahead of the hips as he takes to come to rest, if his legs reach that */
  private hang(foot: Footing, side: Side, dt: number) {
    const { value, velocity } = this
    if (foot.down) {
      if (reaches(foot.at, value)) return
      foot.down = false
    }
    // through the air the legs stay as far apart as they left the ground, drawn up under him
    foot.fore ??= clamp(foot.at.z - value.z, -APART, APART)
    const split = (foot.fore - (this.foot[other(side)].fore ?? foot.fore)) / 2
    const ball = raised(HEEL)
    const touch = SIZE.ankle + ball.y + LANDING * LEG
    const drop = velocity.y * velocity.y + 2 * GRAVITY * (value.y - touch)
    const air = drop > 0 ? (velocity.y + Math.sqrt(drop)) / GRAVITY : 0
    const forth = LEG * Math.sqrt(1 - LANDING * LANDING)
    const brakes = clamp(lands(velocity.z), -forth, forth - ball.z)
    // sent on, he comes down on the foot that has been off the ground for longer, and the other steps on from there
    const waits = this.sent && foot.stood > this.foot[other(side)].stood && !this.has(this.foot[other(side)], dt)
    const to =
      air > UNTUCK || waits
        ? new Vector3(aside(side), value.y - (1 - TUCK) * LEG, value.z + TUCK * LEG * this.way + split)
        : new Vector3(aside(side), SIZE.ankle + ball.y, value.z + velocity.z * air + brakes + ball.z)
    if (air <= dt && !waits) {
      // (the ground holds it where it stands once its heel is down)
      foot.at.set(to.x, SIZE.ankle, to.z - ball.z)
      foot.down = true
      this.trod = this.time
      return
    }
    // it goes with him, and to where it is to be as fast as gets it there in time: no faster than a leg is drawn up
    foot.at
      .addScaledVector(velocity, dt)
      .lerp(to, Math.min(1, dt / Math.max(air > UNTUCK || waits ? AIR.least : air, dt)))
    foot.at.x = aside(side)
  }
}
