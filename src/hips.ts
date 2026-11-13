import { Vector3 } from 'three'
import { ANKLE } from './joints'
import { drop, fly, push } from './jump'
import { HEEL, SIDES, SIGN, SOLE, type Side, type Size, both, ground, raised } from './size'
import type { Stoops } from './stoop'
import { GRAVITY, clamp, due, ease } from './world'

/** how hard a leg on the ground pushes the hips: along it, over half his weight, and up, twice it (m/s²) */
export const PUSH = { along: 6, up: 20 }
/** how fast he walks, and at the most (in his paces), and how hard that pushes the hips (m/s²) */
export const WALK = { speed: 0.476, most: 0.851, push: 2 }
/** how fast he lets himself down, and the hips ride back behind his feet (in his paces) */
export const SINK = 0.34
/** how low the hips go in a stride, for a hand or a foot to reach (m): a lunge, the thigh in front level and the knee behind still off the ground */
export const lunge = ({ ankle, shin }: Size) => ankle + shin
/** how low the hips go, in shares of how high they stand: and so how low (m), and how far they come down at the most for a hand or a foot to reach (m) */
const LOW = 0.316
export const lowest = ({ stand }: Size) => LOW * stand
export const squat = ({ stand }: Size) => (1 - LOW) * stand
/** how much lower than they stand the hips are, going at a walk, as a foot comes down: for its leg to reach ahead of them (in lengths of his leg) */
export const RIDE = 0.057
/** how many times a beat the hips come up again from where they were let down for a hand or a foot */
const RISE = 1.2
/** how long the hips take over the last of their way to rest (in his beats) */
export const SETTLE = 0.835
/** how slow the hips are when they are at rest (in his paces), and how near where they were to come to rest (in lengths of his leg) */
export const STILL = 0.017
export const THERE = 0.0114
/** the least between two footfalls, which is as long as he is in the air between strides at a run (in his beats) */
export const CADENCE = 0.668
/** how fast the hips go at the most while he shifts his weight over his feet, standing on both (in his paces) */
export const SHIFTS = 0.17
/** how long he can be in the air between two footfalls without falling (in his beats) */
const FLIGHT = 1
/** how far apart along z feet are at the most that stand side by side (in lengths of his leg): a step no longer than that is not worth making */
export const TOGETHER = 0.114
/**
 * how much of the angle between his legs the pelvis turns by in his stride, more the faster he runs than he walks,
 * and standing between feet the story has put down; how far it turns at the most (rad), how far it lists under a
 * hanging leg for every m/s² the ground pushes him up (rad), and how many times a beat it comes round
 */
const TURN = { stride: 0.1, stance: 1, most: 0.8, list: 0.09 / GRAVITY, rate: 0.9 }
/**
 * how far a step carries him standing, how much further for every pace he goes, and how much of that the first step
 * out of a stand carries him; and how far he flies between the strides of a run for every pace (in lengths of his leg)
 */
export const STRIDE = { least: 0.568, faster: 0.567, first: 0.5, flown: 0.434 }
/** how long his stride is at a walk, going so many of his paces (m) */
export const stride = ({ leg }: Size, fast: number) => (STRIDE.least + STRIDE.faster * fast) * leg
/**
 * how far off the way he goes he faces before his legs would cross in a stride (rad): from there he sidesteps, the foot
 * whose hip is ahead stepping out so far, and so much further for every pace he goes (in lengths of his leg), and the
 * other up to it, at up to so many of his paces: as fast as his feet step
 */
export const SIDLE = { from: 0.9, step: 0.4, faster: 0.6, most: 0.5 }
/** how far he steps out sidestepping, going so many of his paces (in lengths of his leg) */
export const sidle = (fast: number) => SIDLE.step + SIDLE.faster * fast
/**
 * winding up for an end that is to arrive fast: how much of the way from between his feet to the foot behind his
 * weight goes, and as it swings through, to the one ahead; and how much of the trunk's turn away the pelvis does
 */
export const WOUND = { weight: 0.5, pelvis: 0.5 }

/** where a hip is from the middle of the hips, the pelvis turned so far and listing so far (m) */
export const socket = ({ hip }: Size, side: Side, turn: number, list: number, to: Vector3) =>
  to
    .set(Math.cos(turn) * Math.cos(list), Math.sin(list), -Math.sin(turn) * Math.cos(list))
    .multiplyScalar(SIGN[side] * hip)

/** how far ahead of an ankle the hips ride at the most when they are this high: behind it, low, a shin leaning over its foot only as far as an ankle bends (m) */
export function overhang({ ankle, shin, thigh }: Size, hips: number) {
  const knee = hips - ankle - shin * Math.cos(ANKLE)
  return shin * Math.sin(ANKLE) - Math.sqrt(Math.max(0, thigh ** 2 - knee * knee))
}
/** how far behind his ankles the hips belong when they are this high (m) */
export const behind = (size: Size, hips: number) => Math.max(0, -overhang(size, hips))
/** how far on he comes to rest out of the air: where he lands, both feet braking him, going no faster than he walks, and else stepping on, a foot down half the time (m) */
export const lands = ({ pace }: Size, going: number) =>
  (going * Math.abs(going)) / ((Math.abs(going) > WALK.speed * pace ? 1 : 2) * PUSH.along)

/**
 * a step a foot is making: from where to where, how far through it is, and how long is left of it, as far as it can
 * tell (s); and a step round, where he turns as he stands, which way the foot `points` when it is down, in the scene
 * (rad about y)
 */
export type Step = { from: Vector3; to: Vector3; through: number; remains: number; points?: number }
/**
 * a foot as the ground has it: where its ankle is, which way it points, from the way he is going (rad), whether the
 * ground holds it and when it last did, the step it is making, from when until when the story has it, as it has sent
 * it, where the story has put it to stay on the ground, and in the air, how far ahead of the hips it left the ground
 */
export type Footing = {
  at: Vector3
  toes: number
  down: boolean
  stood: number
  step?: Step
  taken?: { from: number; until: number }
  put?: Vector3
  fore?: number
}
/** how high the hips are to go, how fast, pushed how hard, and how fast they are to arrive: at none, to rest */
type Going = { y: number; speed: number; push: number; arrive: number }
type On = { z?: never; x?: never }
/**
 * where the hips are to go, told along the way he is going: to a place `z` along it and `x` to the side of it, to which
 * that way turns; or on past where they were to arrive; or led, to be going a `heading` in the scene (rad about y, from
 * +z toward +x), to no place
 */
export type Course = Going &
  ({ z: number; x: number; heading?: never } | (On & { heading?: never }) | (On & { heading: number }))
const REST = { x: 0, push: PUSH.along, arrive: 0 }
/** to rest at a place along the way he is going, the hips so high: braked as hard as a leg pushes */
export const toRest = (y: number, z: number, speed: number) => ({ ...REST, z, y, speed })

export const UP = new Vector3(0, 1, 0)
const aside = new Vector3()

/**
 * The hips, which only the ground moves. They have somewhere to go and a speed to go at, and only a foot on the ground
 * pushes them there: with none down they go on as they are going. For a jump he drops, the legs push him off the
 * ground, and he flies until a foot comes down under him.  All of it is told along the way he is going: z along it, x
 * across it to his left, were he facing it. Whichever way he faces, his feet are told as if he faced the way he goes,
 * each under its hip: a leg is to its hip as it is, and a stride is a stride.
 */
export class Hips {
  time = 0
  readonly value = new Vector3()
  readonly velocity = new Vector3()
  readonly acceleration = new Vector3()
  /** how far to the left of the way he is going he faces (rad), and how fast he goes at the most, facing so and to come round to where he is to go (m/s): as whoever turns that way has them */
  faces = 0
  rounds = Infinity
  course: Course
  /** where the hips were sent to stand between feet the story has put down */
  protected stance?: Course
  /** a footfall the steps are to come out at: a foot, if it matters which, down at a place along z */
  plant?: { side?: Side; at: number }
  /** the way that ended on a footfall the steps came out at: come to rest there, he stays on it, the other foot where it was, until he is sent on */
  protected planted?: Course
  /** whether he was sent somewhere in the air: he lands going there */
  sent = false
  /** whether he is led: going as he was told to be, to no place */
  led = false
  /** how high the hips are held wherever he goes, until he is told otherwise (m) */
  height: number
  /** in the air, with nothing to push him */
  falls = false
  /** what went wrong in the last step, to be told: he has fallen, or his legs cannot make the jump or the footfall */
  fault?: string
  /** a jump he is to make: where the hips are at the top of it, and until he lets himself drop for it, the footfall along z he is going to, to take off from */
  spring?: { top: Vector3; from?: number }
  /** the legs pushing him off the ground: what he is to leave it with, and when */
  launch?: { velocity: Vector3; until: number }
  /** how far the pelvis is turned about the vertical, the right hip ahead, and lists, the left hip up (rad), and how fast each changes (rad/s) */
  turn = 0
  turning = 0
  list = 0
  listing = 0
  /**
   * what he winds up for, an end that is to arrive fast: from a moment he is drawn back, the pelvis turned so far (rad)
   * and his weight on the foot behind along a `way`, from another he swings through, the other way, until a last; and
   * which way the hip of that end is `fore`, about the vertical
   */
  wind?: { from: number; swings: number; until: number; turn: number; fore: number; way: number }
  /** how far the hips are let down now for what he gets down for, on their way down or up again (m) */
  low = 0
  /** standing low: how far back the hips ride from where he is to stand, and behind his feet (m) */
  back = 0
  readonly foot: Record<Side, Footing>
  /** whether he bounds along at a run: in the air between two strides, going up and coming down as he left the ground, and on a leg that gives under him like a spring */
  bounds = false
  /** how hard the hips would be pushed along if a foot were down, and for how long none has been */
  protected wanted = 0
  unheld = 0

  constructor(
    readonly size: Size,
    readonly stoops: Stoops,
  ) {
    this.value.y = this.height = size.stand
    this.course = toRest(size.stand, 0, WALK.speed * size.pace)
    this.foot = both((side) => ({ at: ground(size, side, 0), toes: 0, down: true, stood: 0 }))
  }

  /**
   * gives the hips somewhere to go, out of the air once he has come down: what he was to do on the way to where they
   * were going is off. Or has him be going as he is `led` from now on: a jump he is making he still makes
   */
  send(course: Course, led = false) {
    // he steps off feet the story put down: they are his again
    for (const side of SIDES) this.foot[side].put = undefined
    this.plant = undefined
    if (!led) this.spring = undefined
    this.course = course
    this.sent = this.aloft
    this.led = led
  }

  /** whether the place he was sent to is off the way he is going yet: he goes on round to it */
  get veers() {
    const { course } = this
    return course.z !== undefined && Math.abs(course.x) > THERE * this.size.leg
  }

  /** which way he is going along z: or is about to */
  get way() {
    const { course, value, velocity } = this
    if (Math.abs(velocity.z) > STILL * this.size.pace) return Math.sign(velocity.z)
    return Math.sign(course.z === undefined || this.veers ? course.speed : course.z - value.z) || 1
  }

  /** whether he faces so far off the way he goes that his legs would cross in a stride: he sidesteps */
  get sidles() {
    return Math.abs(Math.sin(this.faces)) > Math.sin(SIDLE.from)
  }

  /** how far the ball of a foot is from where it belongs: under its hip, pointing the way he faces, or would, turned on by up to `ahead`, whichever is nearest how it points (m) */
  protected strays(side: Side, ahead = 0) {
    const { at, toes } = this.foot[side]
    const faced = this.faces + clamp(toes - this.faces, Math.min(0, ahead), Math.max(0, ahead))
    const ball = SOLE.ball * this.size.leg
    const { x, z } = this.turned(side, faced)
    const [aside, on] = [at.x - SIGN[side] * this.size.hip - x, at.z - this.value.z - this.back - z]
    return Math.hypot(aside + ball * (Math.sin(toes) - Math.sin(faced)), on + ball * (Math.cos(toes) - Math.cos(faced)))
  }

  /** how far from under its hip, as he faces, a foot stands under it once he faces so far off the way he goes */
  protected turned(side: Side, faced: number) {
    const hip = SIGN[side] * this.size.hip
    return aside.set(hip * (Math.cos(faced) - Math.cos(this.faces)), 0, -hip * (Math.sin(faced) - Math.sin(this.faces)))
  }

  get halt() {
    return this.course.arrive === 0 ? this.course.z : undefined
  }

  /** whether the ground no longer has him: the legs are pushing him off it, or he is in the air */
  get aloft() {
    return this.falls || this.launch !== undefined
  }

  /** whether he is making a jump: dropping for it, pushing off, or in the air */
  get jumps() {
    return this.aloft || this.spring !== undefined
  }

  /** whether he has let himself drop for a jump */
  get drops() {
    return this.spring !== undefined && this.spring.from === undefined
  }

  get rests() {
    const { course, value, velocity } = this
    const { leg, pace } = this.size
    const halts = course.z !== undefined && course.arrive === 0
    const there = halts && Math.hypot(course.x, course.z - this.back - value.z) < THERE * leg
    return there && !this.aloft && velocity.length() < STILL * pace
  }

  /** how he is wound up now, on the ground: 1 drawn back, -1 swinging through, 0 with nothing to wind up for or a jump to make */
  protected get wound() {
    const { wind, time } = this
    return !wind || this.jumps || time < wind.from || time >= wind.until ? 0 : time < wind.swings ? 1 : -1
  }

  protected get together() {
    const { left, right } = this.foot
    return left.down && right.down && Math.abs(left.at.z - right.at.z) <= TOGETHER * this.size.leg
  }

  /** whether the story has put a foot down somewhere: then he stands over his feet as they are */
  get placed() {
    return SIDES.some((side) => this.foot[side].put)
  }

  /** whether getting down is a lunge for him: his feet are apart, and he is going along or stands between feet the story has put down */
  get lunging() {
    return !this.together && (!this.rests || this.placed)
  }

  /** whether he stands lower than he is to go along: he comes up before he sets off, once what he is down for is over, from all that ever is */
  protected get squats() {
    const { leg, pace } = this.size
    const walks = this.course.y - this.stoops.low(Number.MAX_VALUE) - RIDE * leg
    return this.together && Math.abs(this.velocity.z) < SHIFTS * pace && this.value.y < walks
  }

  protected move(dt: number, down: boolean) {
    this.unheld = down ? 0 : this.unheld + dt
    if (this.launch) push(this, dt, this.launch)
    else if (this.falls) fly(this, dt, down)
    else if (!(this.spring && drop(this, dt, this.spring))) this.go(dt, down)
  }

  /** he is down in time for what he gets down for, and comes up again after */
  protected lower(dt: number) {
    const stoop = this.stoops.low(this.time)
    this.low = stoop > this.low ? stoop : stoop + (this.low - stoop) * Math.exp((-RISE * dt) / this.size.beat)
  }

  /** whether the story has a foot over the step of time that ends now: the body does not step with it */
  protected has({ taken }: Footing, dt: number) {
    const from = this.time - dt
    return taken !== undefined && due(from, taken.from) && !due(from, taken.until)
  }

  /** what an error says of his falling `how` he did: what would help, or the feet the story has, which he did not land on */
  fallen(how: string, help: string) {
    const held = SIDES.filter((side) => this.has(this.foot[side], 0))
    const them = held.length > 1 ? 'them' : 'it'
    if (!held.length) return `${how}: ${help}`
    return `${how}, the ${held.join(' and ')} foot the story's: free ${them} before he comes down, or send ${them} to the ground`
  }

  /** how far ahead of the hips a leg points, from straight down (rad) */
  points(side: Side) {
    const { at } = this.foot[side]
    return Math.atan2(at.z - this.value.z, this.value.y - at.y)
  }

  /**
   * the pelvis turns with the feet: the hip of the leg that is ahead goes ahead, and comes round like a thing with
   * weight. And it lists under a leg that is off the ground, whose weight hangs from it while the hip of the other
   * carries it: as heavy as the ground pushes him up
   */
  protected swivel(dt: number) {
    // (a leg the story has is the story's to swing: where it will be is not the body's to tell)
    const [left, right] = SIDES.map((side) => (this.has(this.foot[side], dt) ? 0 : this.points(side)))
    const { beat, pace } = this.size
    const stride = TURN.stride * Math.max(1, Math.abs(this.velocity.z) / (WALK.most * pace))
    const feet = (this.course === this.stance ? TURN.stance : stride) * (right - left)
    // wound up, the hip of the hand is no further behind than square: it turns away while he is drawn back, and is square again ahead of the trunk, which swings for longer than the pelvis comes round
    const { wind, wound } = this
    const turned = wind && wound ? wind.fore * Math.max(0, wind.fore * feet) + (wound > 0 ? wind.turn : 0) : feet
    const want = clamp(turned, -TURN.most, TURN.most)
    const pull = (2 * Math.PI * TURN.rate) / beat
    this.turning = (this.turning + pull * pull * (want - this.turn) * dt) / (1 + pull * dt) ** 2
    this.turn += this.turning * dt
    const hung = (Number(this.foot.left.down) - Number(this.foot.right.down)) * (GRAVITY + this.acceleration.y)
    this.listing = (this.listing + pull * pull * (TURN.list * hung - this.list) * dt) / (1 + pull * dt) ** 2
    this.list += this.listing * dt
  }

  /** the hips sway over the foot he stands on, from where they were along x, like a pendulum as high as they are */
  protected sway(dt: number, from: number) {
    const { value, velocity, foot } = this
    // (facing off the way he goes, the foot is less far to the side of it)
    const over =
      foot.left.down === foot.right.down ? 0 : foot[foot.left.down ? 'left' : 'right'].at.x * Math.cos(this.faces)
    const pull = Math.sqrt(GRAVITY / value.y)
    velocity.x = (velocity.x + pull * pull * (over - from) * dt) / (1 + pull * dt) ** 2
    value.x = from + velocity.x * dt
  }

  private go(dt: number, down: boolean) {
    const { value, velocity, acceleration, foot, size } = this
    const { leg, beat, pace } = size
    const [settle, fastest] = [SETTLE * beat, WALK.most * pace]
    const way = Math.sign(this.course.speed || 1)
    // standing lower than he is to go along, they make for no further on than his feet, to rest there until he has come up
    const { z = way * Infinity, x = 0 } = this.course
    const course: Course = this.squats
      ? { ...this.course, heading: undefined, x, z: way * Math.min(z * way, foot.left.at.z * way), arrive: 0 }
      : this.course
    // wound up where he is to come to rest between his feet, his weight goes onto the one behind, and onto the one ahead as he swings through: as hard as his legs push
    const stands = SIDES.filter((side) => foot[side].down).map((side) => foot[side].at.z)
    const [rear, front] = [Math.min(...stands), Math.max(...stands)]
    const { halt, wound } = this
    const shifts = wound !== 0 && halt !== undefined && halt >= rear && halt <= front
    const load = (this.wind?.way ?? 0) * wound * WOUND.weight
    const weight = shifts ? halt - (rear + front + load * (rear - front)) / 2 : 0
    const along = (course.z ?? Infinity) - this.back - weight - value.z
    // (round to a place that is off the way he is going he goes on, as far as it is off)
    const far = course.z === undefined ? Infinity : this.veers ? Math.hypot(x, along) : along * way
    // past where they were to arrive still going, they go on at that speed: and past where they were to come to rest faster than he walks, to where that carries them
    const { y, push, arrive } = course
    if (far < 0 && arrive > 0) this.course = { y, push, arrive, speed: Math.sign(course.speed) * arrive }
    else if (far < 0 && velocity.z * way > fastest)
      this.course = { ...course, heading: undefined, x, z: value.z + lands(size, velocity.z) }
    // (braked half the time, a foot being down only so much of it: so they are as slow as they are to arrive a stride in the air early)
    const brakes = Math.max(0, Math.abs(far) - (course.arrive && FLIGHT * beat * velocity.z * way))
    // as fast as they are to go, and no faster than lets them slow to how they are to arrive, the last of the way ever slower
    const most = Math.min(
      Math.abs(course.speed),
      Math.sqrt(course.arrive ** 2 + PUSH.along * brakes),
      course.arrive > 0 ? Infinity : Math.abs(far) / settle,
      this.rounds,
    )
    const want = Math.sign(far) * way * most
    const faster = Math.abs(want) > Math.abs(velocity.z) && want * velocity.z >= 0
    const hard = faster && !shifts ? course.push : PUSH.along
    this.wanted = clamp((want - velocity.z) / settle, -hard, hard)
    acceleration.z = down ? clamp((want - velocity.z) / dt, -hard, hard) : 0
    velocity.z += acceleration.z * dt
    value.z += velocity.z * dt
    // they ride as high as they are to, and as a leg on the ground lets them: down for a leg to reach ahead, and at a walk up over the foot he stands on while the other is off the ground, down again as it comes down. Onto a footfall the steps are to come out at he stays down
    const rises = !this.bounds && this.halt !== undefined && this.planted !== this.course
    const up = ({ step }: Footing) => (step && rises ? 1 - ease(step.through) : 0)
    const walks = Math.min(1, Math.abs(velocity.z) / (WALK.speed * pace))
    // (sidestepping they stay as low as his legs reach half a step out to either side)
    const out = sidle(Math.abs(velocity.z) / pace) / 2
    const sunk = (1 - Math.sqrt(1 - out ** 2)) * Math.min(1, Math.abs(velocity.z) / (SIDLE.most * pace))
    const ride = this.sidles ? sunk * leg : RIDE * leg * (1 - Math.max(up(foot.left), up(foot.right))) * walks
    const high = clamp(
      Math.min(course.y - this.low - ride, this.ceiling()),
      // (lower than a lunge he gets only standing with his feet side by side: a knee stays off the ground)
      (this.together ? lowest : lunge)(size),
      size.stand,
    )
    const rise = high - value.y
    // (they come up in half the time they take to settle along)
    const fast = Math.min(Math.sqrt(GRAVITY * Math.abs(rise)), Math.abs(rise) / (settle / 2))
    const wantY = Math.sign(rise) * (rise < 0 ? Math.min(fast, SINK * pace) : fast)
    // nothing but his weight brings him down: and between the strides of a run nothing else moves them, and the leg he lands on gives like a spring that bears his weight too, and has him up again, three quarters of a swing on, in the time he goes its length
    if (down && Math.abs(velocity.z) <= fastest) this.bounds = false
    const swing = (1.5 * Math.PI * velocity.z) / leg
    const sprung = this.bounds && Math.abs(rise) < RIDE * leg ? swing * swing * rise : (wantY - velocity.y) / dt
    acceleration.y = this.bounds && !down ? -GRAVITY : clamp(sprung, -GRAVITY, PUSH.up)
    velocity.y += acceleration.y * dt
    value.y += velocity.y * dt
    // standing low on both feet where he is to come to rest, the hips ride back behind the knees: a shin leans over its foot only as far as an ankle bends
    const still = Math.abs(velocity.z) < SHIFTS * pace && this.halt !== undefined && foot.left.down && foot.right.down
    // (a foot behind him comes up on its toes: it is the one ahead that the hips stay back of, where he is to stand and no further on)
    const back = still ? Math.max(0, Math.min(this.course.z ?? 0, front) - front - overhang(size, value.y)) : 0
    this.back += clamp(back - this.back, -SINK * pace * dt, SINK * pace * dt)
    if (this.unheld > FLIGHT * beat) {
      this.falls = true
      this.fault = this.fallen('he has fallen, no foot under him as he went', 'ask less of his legs')
    }
  }

  /** how high the hips can be at a place along z for a leg on the ground to hold them: or where the story has put a foot, for both to reach where they stand */
  ceiling(z = this.value.z) {
    const { ankle, hip, leg } = this.size
    const reaches = SIDES.filter((side) => this.foot[side].down).map((side) => {
      const { at } = this.foot[side]
      const heel = raised(this.size, z > at.z ? HEEL : 0)
      const flat = Math.hypot(Math.max(0, Math.abs(z - at.z) - heel.z), at.x - SIGN[side] * hip)
      return ankle + heel.y + Math.sqrt(Math.max(0, leg * leg - flat * flat))
    })
    return reaches.length ? (this.placed ? Math.min : Math.max)(...reaches) : Infinity
  }
}
