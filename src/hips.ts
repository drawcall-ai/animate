import { Vector3 } from 'three'
import { ANKLE } from './joints'
import { HEEL, LEG, SIDES, SIGN, SIZE, STAND, type Side, both, raised } from './size'
import type { Stoops } from './stoop'
import { GRAVITY, clamp, due, ease } from './world'

/** how hard a leg on the ground pushes the hips: along it, over half his weight, and up, twice it (m/s²) */
export const PUSH = { along: 6, up: 20 }
/** how fast he walks, and at the most, and how hard that pushes the hips (m/s, m/s²) */
export const WALK = { speed: 1.4, most: 2.5, push: 2 }
/** how fast he lets himself down (m/s) */
export const SINK = 1
/** how low the hips go in a stride, for a hand or a foot to reach (m): a lunge, the thigh in front level and the knee behind still off the ground */
export const LUNGE = SIZE.ankle + SIZE.shin
/** how low the hips go, and how far they come down at the most for a hand or a foot to reach (m) */
export const LOW = 0.3
export const SQUAT = STAND - LOW
/** how much lower than they stand the hips are, going at a walk, as a foot comes down: for its leg to reach ahead of them (m) */
export const RIDE = 0.05
/** how many times a second the hips come up again from where they were let down for a hand or a foot */
const RISE = 4
/** how long the hips take over the last of their way to rest (s) */
export const SETTLE = 0.25
/** how slow the hips are when they are at rest (m/s), and how near where they were to come to rest (m) */
export const STILL = 0.05
const THERE = 0.01
/** how fast the hips go at the most while he shifts his weight over his feet, standing on both (m/s) */
const SHIFTS = 0.5
/** how long he can be in the air between two footfalls without falling (s) */
const FLIGHT = 0.3
/** how far apart along z feet are at the most that stand side by side (m): a step no longer than that is not worth making */
export const TOGETHER = 0.1
/** how much of the angle between his legs the pelvis turns by, in his stride, and more the faster he runs than he walks, and where he was sent to stand between feet the story has put down; how far it turns at the most (rad), how far it lists under a leg that hangs from it for every m/s² the ground pushes him up (rad), and how many times a second it comes round */
const TURN = { stride: 0.1, stance: 1, most: 0.8, list: 0.09 / GRAVITY, rate: 3 }
/** winding up for an end that is to arrive fast: how much of the way from the middle between his feet to the foot behind his weight goes, and as it swings through, to the one ahead; and how much of how far the trunk turns away the pelvis does */
export const WOUND = { weight: 0.5, pelvis: 0.5 }

/** where a hip is from the middle of the hips, the pelvis turned so far and listing so far (m) */
export const socket = (side: Side, turn: number, list: number, to: Vector3) =>
  to.set(Math.cos(turn) * Math.cos(list), Math.sin(list), -Math.sin(turn)).multiplyScalar(SIGN[side] * SIZE.hip)

/** how far ahead of an ankle the hips ride at the most when they are this high: behind it, low, a shin leaning over its foot only as far as an ankle bends (m) */
export function overhang(hips: number) {
  const knee = hips - SIZE.ankle - SIZE.shin * Math.cos(ANKLE)
  return SIZE.shin * Math.sin(ANKLE) - Math.sqrt(Math.max(0, SIZE.thigh ** 2 - knee * knee))
}
/** how far behind his ankles the hips belong when they are this high (m) */
export const behind = (hips: number) => Math.max(0, -overhang(hips))
/** how far on he comes to rest out of the air: where he lands, both feet braking him, going no faster than he walks, and else stepping on, a foot down half the time (m) */
export const lands = (pace: number) => (pace * Math.abs(pace)) / ((Math.abs(pace) > WALK.speed ? 1 : 2) * PUSH.along)

/** a step a foot is making: from where to where, how far through it is, and how long is left of it, as far as it can tell (s) */
export type Step = { from: Vector3; to: Vector3; through: number; remains: number }
/** a foot as the ground has it: where its ankle is, whether the ground holds it and when it last did, the step it is making, from when until when the story has it, as it has sent it, where the story has put it to stay on the ground, and in the air, how far ahead of the hips it left the ground */
export type Footing = {
  at: Vector3
  down: boolean
  stood: number
  step?: Step
  taken?: { from: number; until: number }
  put?: Vector3
  fore?: number
}
/** where the hips are to go: to rest at a place along z, or on past it at a speed, or just on; how high, how fast, and pushed how hard */
export type Course = { z?: number; y: number; speed: number; push: number; arrive: number }

/**
 * The hips, which only the ground moves. They have somewhere to go and a speed to go at, and only a foot on the
 * ground pushes them there: with none down they go on as they are going. For a jump he drops, the legs push him off
 * the ground, and he flies until a foot comes down under him.
 */
export class Hips {
  time = 0
  readonly value = new Vector3(0, STAND, 0)
  readonly velocity = new Vector3()
  readonly acceleration = new Vector3()
  course: Course = { z: 0, y: STAND, speed: WALK.speed, push: PUSH.along, arrive: 0 }
  /** where the hips were sent to stand between feet the story has put down */
  protected stance?: Course
  /** a footfall the steps are to come out at: a foot, if it matters which, down at a place along z */
  plant?: { side?: Side; at: number }
  /** the way that ended on a footfall the steps came out at: come to rest there, he stays on it, the other foot where it was, until he is sent on */
  protected planted?: Course
  /** whether he was sent somewhere in the air: he lands going there */
  sent = false
  /** in the air, with nothing to push him */
  falls = false
  /** a jump he is to make: where the hips are at the top of it, and until he lets himself drop for it, the footfall along z he is going to, to take off from */
  spring?: { top: Vector3; from?: number }
  /** the legs pushing him off the ground: what he is to leave it with, and when */
  launch?: { velocity: Vector3; until: number }
  /** how far the pelvis is turned about the vertical, the right hip ahead, and lists, the left hip up (rad), and how fast each changes (rad/s) */
  turn = 0
  turning = 0
  list = 0
  listing = 0
  /** what he winds up for, an end that is to arrive fast: from a moment he is drawn back, the pelvis turned so far (rad) and his weight on the foot behind along a `way`, from another he swings through, the other way, until a last; and which way the hip of that end is `fore`, about the vertical */
  wind?: { from: number; swings: number; until: number; turn: number; fore: number; way: number }
  /** how far the hips are let down now for what he gets down for, on their way down or up again (m) */
  low = 0
  /** standing low: how far back the hips ride from where he is to stand, and behind his feet (m) */
  back = 0
  readonly foot = both((side): Footing => ({
    at: new Vector3(SIGN[side] * SIZE.hip, SIZE.ankle, 0),
    down: true,
    stood: 0,
  }))
  /** whether he bounds along at a run: in the air between two strides, going up and coming down as he left the ground, and on a leg that gives under him like a spring */
  protected bounds = false
  /** how hard the hips would be pushed along if a foot were down, and for how long none has been */
  protected wanted = 0
  unheld = 0

  /** `stoops` is what he gets down for */
  constructor(readonly stoops: Stoops) {}

  /** gives the hips somewhere to go, out of the air once he has come down: what he was to do on the way to where they were going is off */
  send(course: Course) {
    this.plant = undefined
    this.spring = undefined
    this.course = course
    this.sent = this.aloft
  }

  /** where along z he is to come to rest, if he is to */
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

  /** whether he is at rest where he was to come to rest */
  get rests() {
    const { halt, value, velocity } = this
    const there = halt !== undefined && Math.abs(halt - this.back - value.z) < THERE
    return there && !this.aloft && velocity.length() < STILL
  }

  /** how he is wound up now, on the ground: 1 drawn back, -1 swinging through, 0 with nothing to wind up for or a jump to make */
  protected get wound() {
    const { wind, time } = this
    return !wind || this.jumps || time < wind.from || time >= wind.until ? 0 : time < wind.swings ? 1 : -1
  }

  /** whether his feet stand side by side on the ground */
  protected get together() {
    const { left, right } = this.foot
    return left.down && right.down && Math.abs(left.at.z - right.at.z) <= TOGETHER
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
    const walks = this.course.y - this.stoops.low(Number.MAX_VALUE) - RIDE
    return this.together && Math.abs(this.velocity.z) < SHIFTS && this.value.y < walks
  }

  /** the hips go on by a step of time: `down` is whether a foot is on the ground */
  protected move(dt: number, down: boolean) {
    this.unheld = down ? 0 : this.unheld + dt
    if (this.launch) this.push(dt, this.launch)
    else if (this.falls) this.fly(dt, down)
    else if (!(this.spring && this.drop(dt, this.spring))) this.go(dt, down)
  }

  /** he is down in time for what he gets down for, and comes up again after */
  protected lower(dt: number) {
    const stoop = this.stoops.low(this.time)
    this.low = stoop > this.low ? stoop : stoop + (this.low - stoop) * Math.exp(-RISE * dt)
  }

  /** whether the story has a foot over the step of time that ends now: the body does not step with it */
  protected has({ taken }: Footing, dt: number) {
    const from = this.time - dt
    return taken !== undefined && due(from, taken.from) && !due(from, taken.until)
  }

  /** how far ahead of the hips a leg points, from straight down (rad) */
  points(side: Side) {
    const { at } = this.foot[side]
    return Math.atan2(at.z - this.value.z, this.value.y - at.y)
  }

  /** the pelvis turns with the feet: the hip of the leg that is ahead goes ahead, and comes round like a thing with weight. And it lists under a leg that is off the ground, whose weight hangs from it while the hip of the other carries it: as heavy as the ground pushes him up */
  protected swivel(dt: number) {
    // (a leg the story has is the story's to swing: where it will be is not the body's to tell)
    const [left, right] = SIDES.map((side) => (this.has(this.foot[side], dt) ? 0 : this.points(side)))
    const stride = TURN.stride * Math.max(1, Math.abs(this.velocity.z) / WALK.most)
    const feet = (this.course === this.stance ? TURN.stance : stride) * (right - left)
    // wound up, the hip of the hand is no further behind than square: it turns away while he is drawn back, and is square again ahead of the trunk, which swings for longer than the pelvis comes round
    const { wind, wound } = this
    const turned = wind && wound ? wind.fore * Math.max(0, wind.fore * feet) + (wound > 0 ? wind.turn : 0) : feet
    const want = clamp(turned, -TURN.most, TURN.most)
    const pull = 2 * Math.PI * TURN.rate
    this.turning = (this.turning + pull * pull * (want - this.turn) * dt) / (1 + pull * dt) ** 2
    this.turn += this.turning * dt
    const hung = (Number(this.foot.left.down) - Number(this.foot.right.down)) * (GRAVITY + this.acceleration.y)
    this.listing = (this.listing + pull * pull * (TURN.list * hung - this.list) * dt) / (1 + pull * dt) ** 2
    this.list += this.listing * dt
  }

  /** the hips sway over the foot he stands on, from where they were along x, like a pendulum as high as they are */
  protected sway(dt: number, from: number) {
    const { value, velocity, foot } = this
    const over = foot.left.down === foot.right.down ? 0 : foot[foot.left.down ? 'left' : 'right'].at.x
    const pull = Math.sqrt(GRAVITY / value.y)
    velocity.x = (velocity.x + pull * pull * (over - from) * dt) / (1 + pull * dt) ** 2
    value.x = from + velocity.x * dt
  }

  /** on the ground the hips make for where they are to go: pushed only if a foot is down */
  private go(dt: number, down: boolean) {
    const { value, velocity, acceleration, foot } = this
    const way = Math.sign(this.course.speed || 1)
    // standing lower than he is to go along, they make for no further on than his feet, to rest there until he has come up
    const course = this.squats
      ? { ...this.course, z: way * Math.min((this.course.z ?? way * Infinity) * way, foot.left.at.z * way), arrive: 0 }
      : this.course
    // wound up where he is to come to rest between his feet, his weight goes onto the one behind, and onto the one ahead as he swings through: as hard as his legs push
    const stands = SIDES.filter((side) => foot[side].down).map((side) => foot[side].at.z)
    const [rear, front] = [Math.min(...stands), Math.max(...stands)]
    const { halt, wound } = this
    const shifts = wound !== 0 && halt !== undefined && halt >= rear && halt <= front
    const load = (this.wind?.way ?? 0) * wound * WOUND.weight
    const weight = shifts ? halt - (rear + front + load * (rear - front)) / 2 : 0
    const far = course.z === undefined ? Infinity : (course.z - this.back - weight - value.z) * way
    // past where they were to arrive still going, they go on at that speed: and past where they were to come to rest faster than he walks, to where that carries them
    if (far < 0 && course.arrive > 0)
      this.course = { ...course, z: undefined, speed: Math.sign(course.speed) * course.arrive }
    else if (far < 0 && velocity.z * way > WALK.most) this.course = { ...course, z: value.z + lands(velocity.z) }
    // (braked half the time, a foot being down only so much of it: so they are as slow as they are to arrive a stride in the air early)
    const brakes = Math.max(0, Math.abs(far) - (course.arrive && FLIGHT * velocity.z * way))
    // as fast as they are to go, and no faster than lets them slow to how they are to arrive, the last of the way ever slower
    const most = Math.min(
      Math.abs(course.speed),
      Math.sqrt(course.arrive ** 2 + PUSH.along * brakes),
      course.arrive > 0 ? Infinity : Math.abs(far) / SETTLE,
    )
    const want = Math.sign(far) * way * most
    const faster = Math.abs(want) > Math.abs(velocity.z) && want * velocity.z >= 0
    const hard = faster && !shifts ? course.push : PUSH.along
    this.wanted = clamp((want - velocity.z) / SETTLE, -hard, hard)
    acceleration.z = down ? clamp((want - velocity.z) / dt, -hard, hard) : 0
    velocity.z += acceleration.z * dt
    value.z += velocity.z * dt
    // they ride as high as they are to, and as a leg on the ground lets them: down for a leg to reach ahead, and at a walk up over the foot he stands on while the other is off the ground, down again as it comes down. Onto a footfall the steps are to come out at he stays down
    const rises = !this.bounds && this.halt !== undefined && this.planted !== this.course
    const up = ({ step }: Footing) => (step && rises ? 1 - ease(step.through) : 0)
    const ride = RIDE * (1 - Math.max(up(foot.left), up(foot.right))) * Math.min(1, Math.abs(velocity.z) / WALK.speed)
    const high = clamp(
      Math.min(course.y - this.low - ride, this.ceiling()),
      // (lower than a lunge he gets only standing with his feet side by side: a knee stays off the ground)
      this.together ? LOW : LUNGE,
      STAND,
    )
    const rise = high - value.y
    // (they come up in half the time they take to settle along)
    const fast = Math.min(Math.sqrt(GRAVITY * Math.abs(rise)), Math.abs(rise) / (SETTLE / 2))
    // he lets himself down no faster than he does
    const wantY = Math.sign(rise) * (rise < 0 ? Math.min(fast, SINK) : fast)
    // nothing but his weight brings him down: and between the strides of a run nothing else moves them, and the leg he lands on gives like a spring that bears his weight too, and has him up again, three quarters of a swing on, in the time he goes its length
    if (down && Math.abs(velocity.z) <= WALK.most) this.bounds = false
    const swing = (1.5 * Math.PI * velocity.z) / LEG
    const sprung = this.bounds && Math.abs(rise) < RIDE ? swing * swing * rise : (wantY - velocity.y) / dt
    acceleration.y = this.bounds && !down ? -GRAVITY : clamp(sprung, -GRAVITY, PUSH.up)
    velocity.y += acceleration.y * dt
    value.y += velocity.y * dt
    // standing low on both feet where he is to come to rest, the hips ride back behind the knees: a shin leans over its foot only as far as an ankle bends
    const still = Math.abs(velocity.z) < SHIFTS && this.halt !== undefined && foot.left.down && foot.right.down
    // (a foot behind him comes up on its toes: it is the one ahead that the hips stay back of, where he is to stand and no further on)
    const back = still ? Math.max(0, Math.min(this.course.z ?? 0, front) - front - overhang(value.y)) : 0
    this.back += clamp(back - this.back, -dt, dt)
    // with no foot down and none coming he falls
    if (this.unheld > FLIGHT) this.falls = true
  }

  /** how high the hips can be at a place along z for a leg on the ground to hold them: or where the story has put a foot, for both to reach where they stand */
  ceiling(z = this.value.z) {
    const reaches = SIDES.filter((side) => this.foot[side].down).map((side) => {
      const { at } = this.foot[side]
      const heel = raised(z > at.z ? HEEL : 0)
      const flat = Math.hypot(Math.max(0, Math.abs(z - at.z) - heel.z), at.x - SIGN[side] * SIZE.hip)
      return SIZE.ankle + heel.y + Math.sqrt(Math.max(0, LEG * LEG - flat * flat))
    })
    return reaches.length ? (this.placed ? Math.min : Math.max)(...reaches) : Infinity
  }

  /**
   * For a jump he lets himself drop, going on as he is going, until the legs, pushing up as hard as they push, have
   * him as high as he stands by the time he is going as he is to leave the ground: then they push, the drop and the
   * push one movement, and along as hard as has the hips where they are to be at the top. Going to a footfall, he first
   * goes on until the drop and half the push carry him there, to be pushed as he comes over it: tells whether he drops.
   */
  private drop(dt: number, spring: { top: Vector3; from?: number }) {
    const [{ value, velocity }, { top, from }] = [this, spring]
    // how fast he leaves the ground to be so high at the top, how fast he is falling by the time the legs catch him, and how long until then
    const up = Math.sqrt(2 * GRAVITY * (top.y - STAND))
    const [way, speed] = [STAND - value.y, up - velocity.y]
    const caught = velocity.y ** 2 * PUSH.up + GRAVITY * (up * up - 2 * PUSH.up * way)
    const fall = Math.sqrt(Math.max(0, caught) / (PUSH.up + GRAVITY))
    const until = (velocity.y + fall) / GRAVITY
    if (from !== undefined) {
      const along = ((top.z - from) * GRAVITY) / up
      const carried = velocity.z * until + ((velocity.z + along) / 4) * ((up + fall) / PUSH.up)
      // (coming to rest there, the last of the way is ever slower: he drops as it begins)
      const near = Math.max(Math.abs(carried), this.halt === undefined ? 0 : Math.abs(velocity.z) * SETTLE)
      if ((from - value.z) * Math.sign(carried) > near && !this.rests) return false
      spring.from = undefined
    }
    if (until > 0) {
      this.fly(dt, false)
      return true
    }
    // from lower than that they push less hard, over the whole way up; coming down faster than he is to go up, as hard as they push
    const lasts = up + velocity.y > 0 ? (2 * way) / (up + velocity.y) : speed / PUSH.up
    const along = (top.z - value.z - (velocity.z * lasts) / 2) / (lasts / 2 + up / GRAVITY)
    // the ground pushes him along the harder the harder the legs push up
    const [hard, most] = [Math.abs(along - velocity.z) / lasts, PUSH.along * (1 + PUSH.up / GRAVITY)]
    if (value.y < LOW || hard > most) {
      throw new Error(
        `a jump that has the hips ${top.y.toFixed(2)} m up at the top, ${(top.z - value.z).toFixed(2)} m on from where the legs begin to push, takes them a push over ${way.toFixed(2)} m, and to push him ${hard.toFixed(1)} m/s² along: they bend ${SQUAT.toFixed(2)} m, and push ${most.toFixed(1)} m/s² along. Ask for a top that is lower, or ${Math.abs(along) < Math.abs(velocity.z) ? 'further on, or to come in slower' : 'nearer where he takes off'}`,
      )
    }
    this.launch = { velocity: new Vector3(0, up, along), until: this.time - dt + lasts }
    this.spring = undefined
    this.push(dt, this.launch)
    return true
  }

  /** the legs push him off the ground, as hard as gets him going as he is to leave it by then */
  private push(dt: number, launch: { velocity: Vector3; until: number }) {
    const { value, velocity, acceleration } = this
    const left = Math.max(dt, launch.until - this.time + dt)
    acceleration.copy(launch.velocity).sub(velocity).divideScalar(left)
    velocity.addScaledVector(acceleration, dt)
    value.addScaledVector(velocity, dt)
    if (this.time < launch.until) return
    this.launch = undefined
    this.falls = true
  }

  /** in the air he flies as he was going, until he comes down on a foot: then he goes where he was sent in the air, or makes for a stand where his speed carries him */
  private fly(dt: number, down: boolean) {
    const { value, velocity, acceleration } = this
    acceleration.set(0, -GRAVITY, 0)
    velocity.y -= GRAVITY * dt
    value.addScaledVector(velocity, dt)
    if (value.y < 0) throw new Error('he has fallen to the ground with no foot under him: leave him one of his own')
    if (!down || velocity.y > 0) return
    this.falls = this.bounds = false
    if (!this.sent)
      this.course = { z: value.z + lands(velocity.z), y: STAND, speed: velocity.z || 1, push: PUSH.along, arrive: 0 }
    this.sent = false
  }
}
