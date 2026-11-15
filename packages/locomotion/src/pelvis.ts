import { Vector3 } from 'three'
import {
  PUSH,
  RIDE,
  SETTLE,
  SHIFTS,
  SIDLE,
  SINK,
  STILL,
  THERE,
  TOGETHER,
  WALK,
  lands,
  lowest,
  lunge,
  overhang,
  sidle,
} from './gait'
import { drop, fly, push } from './jump'
import { both, clamp, damped, due, ease, GRAVITY, ground, HEEL, raised, type Side, SIDES, SIGN, type Size, SOLE } from '@drawcall/limbs'
import type { Stoops } from './stoops'
import { type Wind, pelvis, weight, wound } from './wind'

/** how many times a beat the hips come up again from where they were let down for a hand or a foot */
const RISE = 1.2
/** how long he can be in the air between two footfalls without falling (in his beats) */
const FLIGHT = 1
/**
 * how much of the angle between his legs the pelvis turns by in his stride, more the faster he runs than he walks,
 * and standing between feet the story has put down; how far it turns at the most (rad), how far it lists under a
 * hanging leg for every m/s² the ground pushes him up (rad), and how many times a beat it comes round
 */
const TURN = { stride: 0.1, stance: 1, most: 0.8, list: 0.09 / GRAVITY, rate: 0.9 }
/**
 * standing at his ease, which he takes a while to come to (in his beats) and leaves at once, his weight drifts from foot
 * to foot: the hips over a foot (of how far out a hip is), the pelvis listing with them (rad), by two slow swells that
 * never come round together (in his beats); and always, a breath takes so long (in his beats) and lifts the chest so
 * far, and with it the shoulders (in lengths of his trunk), up to twice as deep and fast out of breath, which he runs
 * out of and gets back so fast (in his beats)
 */
const IDLE = 2
const DRIFT = { over: 0.15, list: 0.025, swells: [29, 47] }
const BREATH = { every: 14, lift: 0.02, runs: 20, recovers: 60 }

/** where a hip is from the middle of the hips, the pelvis turned so far and listing so far (m) */
export const socket = ({ hip }: Size, side: Side, turn: number, list: number, to: Vector3) =>
  to
    .set(Math.cos(turn) * Math.cos(list), Math.sin(list), -Math.sin(turn) * Math.cos(list))
    .multiplyScalar(SIGN[side] * hip)

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
/** to rest at a place along the way he is going, the hips so high: braked as hard as a leg pushes */
export const toRest = (y: number, z: number, speed: number) => ({ x: 0, push: PUSH.along, arrive: 0, z, y, speed })

const aside = new Vector3()

/**
 * The hips, which only the ground moves. They have somewhere to go and a speed to go at, and only a foot on the ground
 * pushes them there: with none down they go on as they are going. For a jump he drops, the legs push him off the
 * ground, and he flies until a foot comes down under him.  All of it is told along the way he is going: z along it, x
 * across it to his left, were he facing it. Whichever way he faces, his feet are told as if he faced the way he goes,
 * each under its hip: a leg is to its hip as it is, and a stride is a stride.
 */
export class Pelvis {
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
  /** what went wrong in the last step, to be told: the story's feet left him none to come down on */
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
  /** what he winds up for, an end that is to arrive fast */
  wind?: Wind
  /** how far the hips are let down now for what he gets down for, on their way down or up again (m) */
  low = 0
  /** how far he stands at his ease, with nothing asked of him but to stand where he is: from 0 to 1 */
  idle = 0
  /** how far through a breath he is (rad), and how far out of breath, from 0 to 1 */
  private breath = 0
  private winded = 0
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
    // sent somewhere, he steps off feet the story put down: they are his again. Led, he keeps his stance
    if (!led) for (const side of SIDES) this.foot[side].put = undefined
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

  /**
   * whether he faces so far off the way he goes that his legs would cross, his feet as far apart along it as they are
   * or are stepping to and as far apart as his hips across him: he sidesteps. Feet side by side cross only as he faces
   * square to it
   */
  get sidles() {
    const { left, right } = this.foot
    const far = Math.max(
      Math.abs(left.at.z - right.at.z),
      Math.abs((left.step?.to ?? left.at).z - (right.step?.to ?? right.at).z),
      THERE * this.size.leg,
    )
    return far * Math.abs(Math.sin(this.faces)) > 2 * this.size.hip * Math.abs(Math.cos(this.faces))
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

  get halted() {
    const { course, value, velocity } = this
    const { leg, pace } = this.size
    const halts = course.z !== undefined && course.arrive === 0
    const there = halts && Math.hypot(course.x, course.z - this.back - value.z) < THERE * leg
    return there && !this.aloft && velocity.length() < STILL * pace
  }

  /** how he is wound up now, on the ground: 1 drawn back, -1 swinging through, 0 with nothing to wind up for or a jump to make */
  protected get wound() {
    return wound(this.wind, this.time, this.jumps)
  }

  protected get together() {
    const { left, right } = this.foot
    return left.down && right.down && Math.abs(left.at.z - right.at.z) <= TOGETHER * this.size.leg
  }

  /** whether the story has put a foot down somewhere: then he stands over his feet as they are */
  get placed() {
    return SIDES.some((side) => this.foot[side].put)
  }

  /** where he stands between his feet, as they stand or are to, told along the way he is going */
  between() {
    const [left, right] = SIDES.map((side) => {
      const { put, step, at } = this.foot[side]
      return put ?? step?.to ?? at
    })
    return new Vector3().addVectors(left, right).multiplyScalar(0.5)
  }

  /** how low the hips get: lower than a lunge only standing with his feet side by side, a knee staying off the ground */
  protected get deepest() {
    return (this.together ? lowest : lunge)(this.size)
  }

  /** whether getting down is a lunge for him: his feet are apart, and he is going along or stands between feet the story has put down */
  get lunging() {
    return !this.together && (!this.halted || this.placed)
  }

  /** how high the hips are to ride: as high as they are held, but at a run as high as he stands, held lower or not, until he has slowed to a walk */
  get rides() {
    return Math.abs(this.velocity.z) > WALK.most * this.size.pace ? this.size.stand : this.course.y
  }

  /** whether he stands lower than he is to go along: he comes up before he sets off, once what he is down for now is over */
  protected get squats() {
    const { leg, pace } = this.size
    const walks = this.course.y - this.stoops.low(this.time) - RIDE * leg
    return this.together && Math.abs(this.velocity.z) < SHIFTS * pace && this.value.y < walks
  }

  /** he comes to his ease where he is to rest, on both feet and slow, with no foot put down, no jump and no wind-up */
  protected idles(dt: number) {
    const { halt, course, value, velocity, foot } = this
    const { leg, beat, pace } = this.size
    const near = halt !== undefined && Math.hypot(course.x ?? 0, halt - this.back - value.z) < THERE * leg
    const still = near && Math.abs(velocity.z) < SHIFTS * pace && foot.left.down && foot.right.down
    const free = still && !this.placed && !this.jumps && this.wound === 0
    this.idle = free ? Math.min(1, this.idle + dt / (IDLE * beat)) : 0
    // and he breathes, deeper and faster for a while after a run
    const runs = Math.abs(velocity.z) > WALK.most * pace ? 1 : 0
    this.winded += (runs - this.winded) * Math.min(1, dt / ((runs ? BREATH.runs : BREATH.recovers) * beat))
    this.breath += (2 * Math.PI * (1 + this.winded) * dt) / (BREATH.every * beat)
  }

  /** how far up his breath lifts his chest (m): whatever he does, he breathes */
  get breathes() {
    return (BREATH.lift * this.size.trunk * (1 + this.winded) * (1 - Math.cos(this.breath))) / 2
  }

  /** how far his weight has drifted toward his left foot as he stands at his ease, from -1 to 1 */
  protected get drifts() {
    const [slow, fast] = DRIFT.swells.map((beats) => Math.sin((2 * Math.PI * this.time) / (beats * this.size.beat)))
    return (this.idle * (slow + fast)) / 2
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

  /** what an error says of his falling `how` he did, if the story made him: the feet it has, which he did not land on */
  fallen(how: string) {
    const held = SIDES.filter((side) => this.has(this.foot[side], 0))
    const them = held.length > 1 ? 'them' : 'it'
    if (!held.length) return undefined
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
    const want = clamp(pelvis(this.wind, this.wound, feet), -TURN.most, TURN.most)
    const pull = (2 * Math.PI * TURN.rate) / beat
    this.turning = damped(this.turning, want - this.turn, pull, dt)
    this.turn += this.turning * dt
    // (and at his ease, the hip over the foot his weight has drifted onto goes up)
    const hung = (Number(this.foot.left.down) - Number(this.foot.right.down)) * (GRAVITY + this.acceleration.y)
    const lists = TURN.list * hung + DRIFT.list * this.drifts
    this.listing = damped(this.listing, lists - this.list, pull, dt)
    this.list += this.listing * dt
  }

  /** the hips sway over the foot he stands on, no further than so far, or as far as his weight has drifted, from where they were along x, like a pendulum as high as they are */
  protected sway(dt: number, from: number, most = Infinity) {
    const { value, velocity, foot } = this
    // (facing off the way he goes, the foot is less far to the side of it)
    const drifted = DRIFT.over * this.size.hip * this.drifts
    const under = foot[foot.left.down ? 'left' : 'right'].at.x * Math.cos(this.faces)
    const over = foot.left.down === foot.right.down ? drifted : clamp(under, -most, most)
    const pull = Math.sqrt(GRAVITY / value.y)
    velocity.x = damped(velocity.x, over - from, pull, dt)
    value.x = from + velocity.x * dt
  }

  private go(dt: number, down: boolean) {
    const { value, velocity, acceleration, foot, size } = this
    const { leg, beat, pace, hip } = size
    const [settle, fastest] = [SETTLE * beat, WALK.most * pace]
    const way = Math.sign(this.course.speed || 1)
    // (led a way, he goes as fast as the world has him going, a foot down or not)
    const led = this.course.heading !== undefined
    // standing lower than he is to go along, they make for no further on than his feet, to rest there until he has come up
    const { z = way * Infinity, x = 0 } = this.course
    const course: Course =
      this.squats && !led
        ? { ...this.course, heading: undefined, x, z: way * Math.min(z * way, foot.left.at.z * way), arrive: 0 }
        : this.course
    // wound up where he is to come to rest between his feet, his weight goes onto the one behind, and onto the one ahead as he swings through: as hard as his legs push
    const stands = SIDES.filter((side) => foot[side].down).map((side) => foot[side].at.z)
    const [rear, front] = [Math.min(...stands), Math.max(...stands)]
    const shift = weight(this.wind, this.wound, this.halt, rear, front)
    const along = (course.z ?? Infinity) - this.back - (shift ?? 0) - value.z
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
    const most = led
      ? Math.abs(course.speed)
      : Math.min(
          Math.abs(course.speed),
          Math.sqrt(course.arrive ** 2 + PUSH.along * brakes),
          course.arrive > 0 ? Infinity : Math.abs(far) / settle,
          this.rounds,
        )
    const want = Math.sign(far) * way * most
    const faster = Math.abs(want) > Math.abs(velocity.z) && want * velocity.z >= 0
    const hard = faster && shift === undefined ? course.push : PUSH.along
    this.wanted = clamp((want - velocity.z) / settle, -hard, hard)
    // (how hard the world urges him on, he leans into as it is said)
    acceleration.z = down && !led ? clamp((want - velocity.z) / dt, -hard, hard) : 0
    velocity.z = led ? want : velocity.z + acceleration.z * dt
    value.z += velocity.z * dt
    // (led, where his feet were put goes with him: he steps his stance along)
    if (led) for (const side of SIDES) if (foot[side].put) foot[side].put.z += velocity.z * dt
    // they ride as high as they are to, and as a leg on the ground lets them: down for a leg to reach ahead, and at a walk up over the foot he stands on while the other is off the ground, down again as it comes down. Onto a footfall the steps are to come out at he stays down
    const rises = !this.bounds && this.halt !== undefined && this.planted !== this.course
    const up = ({ step }: Footing) => (step && rises ? 1 - ease(step.through) : 0)
    const walks = Math.min(1, Math.abs(velocity.z) / (WALK.speed * pace))
    // (sidestepping they stay as low as his legs reach half a step out to either side)
    const out = sidle(Math.abs(velocity.z) / pace) / 2
    const sunk = (1 - Math.sqrt(1 - out ** 2)) * Math.min(1, Math.abs(velocity.z) / (SIDLE.most * pace))
    const ride = this.sidles ? sunk * leg : RIDE * leg * (1 - Math.max(up(foot.left), up(foot.right))) * walks
    // (his weight drifted over a foot, they are as much lower as has that leg reach from out over it, its hip up)
    const drift = this.drifts
    const sag = hip * Math.abs(Math.sin(DRIFT.list * drift)) + (DRIFT.over * hip * drift) ** 2 / (2 * leg)
    const high = clamp(Math.min(this.rides - this.low - ride, this.ceiling()) - sag, this.deepest, size.stand)
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
      this.fault = this.fallen('he has fallen, no foot under him as he went')
    }
  }

  /** how high the hips can be at a place along z for a leg on the ground to hold them, or for the legs of feet that stand at places: or where the story has put a foot, for both to reach where they stand */
  ceiling(
    z = this.value.z,
    sides = SIDES.filter((side) => this.foot[side].down),
    stands = (side: Side) => this.foot[side].at,
  ) {
    const { ankle, hip, leg } = this.size
    const reaches = sides.map((side) => {
      const at = stands(side)
      const heel = raised(this.size, z > at.z ? HEEL : 0)
      const flat = Math.hypot(Math.max(0, Math.abs(z - at.z) - heel.z), at.x - SIGN[side] * hip)
      return ankle + heel.y + Math.sqrt(Math.max(0, leg * leg - flat * flat))
    })
    return reaches.length ? (this.placed ? Math.min : Math.max)(...reaches) : Infinity
  }
}
