import { type Object3D, Quaternion, Vector3 } from 'three'
import type { Ahead } from './ahead'
import { clamp, EXACT, GRAVITY, type Joints, type Side, SIDES, type Size, type Story, UP, waits, wrap, type Xyz } from '@drawcall/limbs'
import { HIGH, PUSH, RIDE, RUN, SLOW, STILL, THERE, TOGETHER, WALK } from './gait'
import { held } from './heights'
import type { Mover } from './mover'
import { type Course, toRest } from './pelvis'
import type { Reactions } from './reactions'

/** a place on the ground: or told as a number, so far along z on x = 0 */
export type Ground = number | { x: number; z: number }
export const flat = (to: Ground) => (typeof to === 'number' ? { x: 0, z: to } : to)
export type Run = { speed: number; at: Ground; plant?: Side; push?: number; arrive?: number }
export type Walk = { speed?: number; plant?: Side }
/** how far ahead he is looked at for a moment to come, in his beats */
const LONG = 400
/** over how long the turning of the way he is led, and his being led faster or slower, are told (in his beats) */
const TOLD = 0.25
const spot = new Vector3()

/** the clock he goes by: the seconds it has gone on for, and a story over at a moment on it */
type Clock = { readonly time: number; until(when: number): Story }

/**
 * Where he goes, which way he faces and where he looks: what a story or a game says of that, as the body's statements
 * of the same names, given to the hips as a way to go and checked as it is given.
 */
export class Going {
  /** the place he looks at, if he does, and the point of a thing he looks over at it */
  looked?: Vector3
  /** where he looked at the end of the last update: he looks from there to where he is to look as the update goes on */
  private before?: Vector3
  over?: { on: Object3D; at: Vector3 }
  /** where the world has the hips at the moment the next update is for, until it is made */
  private placed?: Vector3
  /** how he was last led to go along the ground, and when: the change of it is how he is urged on, and how fast the way he is led turns (rad/s) */
  private told?: { velocity: Vector3; time: number }
  private turns = 0
  private faster = 0
  /** the way he was led on since the last update, which is for the moment that update is for */
  private lead?: Course
  /** the way he was last to face, and when, the change of which is how fast it turns; and whether that was told since the last update */
  private faced?: { face: number; time: number }
  private aimed = false

  constructor(
    private readonly body: Clock,
    private readonly size: Size,
    private readonly mover: Mover,
    private readonly ahead: Ahead,
    private readonly joints: Joints,
    private readonly reactions: Reactions,
    private readonly hips: Readonly<Record<'value' | 'velocity', Vector3>>,
  ) {}

  /** the hips go to a place at a walk, or are held at a height */
  to(target: Xyz | { y: number }, way?: Walk) {
    return 'x' in target ? this.walkTo(target, way) : this.height(target.y, way)
  }

  /**
   * the hips are at a place on the ground at the moment the next update is for, where the world has them, and the
   * ground there is as high as its y
   */
  at(place: { x: number; y?: number; z: number }) {
    if (!Number.isFinite(place.x + place.z + (place.y ?? 0)))
      throw new Error('the hips are at a place that no numbers say')
    if (place.y !== undefined) this.mover.floor(place.y)
    this.placed = new Vector3(place.x, 0, place.z)
  }

  /** an update is to be made for a moment: where the world has the hips is where they are by then */
  places(time: number) {
    const { mover } = this
    const { course } = mover
    const early = time - this.body.time
    // told anew in every update, how he is led and the way he is to face go on changing as they change, from now as
    // has them so by then; told once, they hold
    if (course.heading !== undefined && course === this.lead) {
      course.heading = wrap(course.heading - course.turns * early)
      course.speed = Math.max(0, course.speed - course.faster * early)
    } else if (course.heading !== undefined) course.turns = course.faster = 0
    if (this.aimed && mover.face !== undefined) mover.face = wrap(mover.face - mover.swings * early)
    else mover.swings = 0
    this.lead = undefined
    this.aimed = false
    if (!this.placed) return
    this.mover.at(this.placed, time)
    this.placed = undefined
    this.ahead.stale()
  }

  /** the hips go to a place at a walk */
  private walkTo(target: Xyz, { speed = WALK.speed * this.size.pace, plant }: Walk = {}) {
    const { mover } = this
    if (!(speed > 0)) throw new Error(`the hips are sent somewhere at ${speed} m/s`)
    const to = mover.local(new Vector3().copy(target))
    const [along, far] = [to.z - mover.value.z, Math.hypot(to.x, to.z - mover.value.z)]
    // (no faster than he walks)
    const fast = Math.min(speed, WALK.most * this.size.pace)
    const y = held(mover, target.y, { far, z: to.z })
    const course = { z: to.z, x: to.x, y, speed: (Math.sign(along) || 1) * fast, push: WALK.push, arrive: 0 }
    return plant ? this.plant(course, target, plant).arrives : this.send(course)
  }

  /**
   * The hips are held so high wherever he goes, until he is told otherwise. The story it returns is over when they
   * are so high, as high as he walks with them going along, and gives false if they were held at another height before.
   */
  private height(y: number, way?: Walk) {
    const { mover } = this
    const { course } = mover
    if (way) throw new Error('the hips are held at a height, at no speed and on no foot: walk somewhere for that')
    y = held(mover, y)
    mover.height = course.y = y
    this.ahead.stale()
    const off = () => mover.value.y + mover.low - y
    const { leg } = this.size
    return waits(
      () => mover.height === y,
      () => off() < HIGH * leg && off() > -(HIGH + RIDE) * leg,
    )
  }

  when(to: Ground) {
    const { mover } = this
    const { x, z } = flat(to)
    const along = (copy: Mover) => copy.local(spot.set(x, 0, z))
    const here = along(mover)
    const { course } = mover
    const halts = course.z !== undefined && !course.arrive && Math.hypot(here.x - course.x, here.z - course.z) < EXACT
    // which way along his way it lies, from when it is on it
    let way: number | undefined
    const seconds = this.ahead.first((copy) => {
      const there = along(copy)
      const off = Math.abs(there.x) > TOGETHER * this.size.leg
      way = off ? undefined : (way ?? (Math.sign(there.z - copy.value.z) || 1))
      return (way !== undefined && copy.value.z * way >= there.z * way) || (halts && copy.halted)
    }, LONG * this.size.beat)
    return seconds === undefined ? Number.NaN : this.body.time + seconds
  }

  highest() {
    const past = ({ falls, velocity, spring }: Mover) => falls && velocity.y <= 0 && !spring
    const seconds = this.mover.jumps && !past(this.mover) ? this.ahead.first(past, LONG * this.size.beat) : undefined
    return this.body.time + (seconds ?? 0)
  }

  walk(to: Ground, way: Walk = {}) {
    return this.to({ ...flat(to), y: this.mover.height }, way)
  }

  run({ speed, at, plant, push = RUN.push, arrive = speed }: Run): Story {
    const place = { ...flat(at), y: this.size.stand }
    const to = this.mover.local(new Vector3().copy(place))
    if (!(speed > 0 && push > 0 && arrive > 0 && Number.isFinite(to.x + to.z))) {
      throw new Error('a run has a place to end at, and a speed, a push and a speed to arrive at above 0')
    }
    // (no faster than he sprints, pushed no harder than a leg pushes, and arriving no faster than he runs)
    const fast = Math.min(speed, RUN.most * this.size.pace)
    const course = {
      z: to.z,
      x: to.x,
      y: place.y,
      speed: fast,
      push: Math.min(push, PUSH.along),
      arrive: Math.min(arrive, fast),
    }
    this.mover.height = held(this.mover, this.mover.height, { speed: fast })
    return this.body.until(this.plant(course, place, plant).over)
  }

  go(velocity: { x: number; z: number }) {
    const { mover } = this
    const { pace } = this.size
    if (!Number.isFinite(velocity.x + velocity.z))
      throw new Error('he is to be going as no numbers say')
    // (no faster than he sprints)
    const speed = Math.min(Math.hypot(velocity.x, velocity.z), RUN.most * pace)
    // (how fast he is led faster, or slower, no harder than his legs push, as it has been over the last beat)
    const now = new Vector3(velocity.x, 0, velocity.z).clampLength(0, speed)
    const was = this.told
    if (was && this.body.time > was.time) {
      const gone = this.body.time - was.time
      const urged = now.clone().sub(was.velocity).divideScalar(gone).clampLength(0, PUSH.along)
      this.reactions.urged.lerp(urged, Math.min(1, gone / this.size.beat))
      // (the way he is led turns only as he goes, not as he comes to a stand and sets off another way)
      const moved = Math.min(now.length(), was.velocity.length()) > SLOW * pace
      // (no faster than the ground turns him at the speed he is led, a foot held twice as hard as he weighs at the
      // most: a way he is led that jumps round is no turn)
      const most = (2 * GRAVITY) / Math.max(speed, SLOW * pace)
      const rate = wrap(Math.atan2(now.x, now.z) - Math.atan2(was.velocity.x, was.velocity.z)) / gone
      const turned = moved ? clamp(rate, -most, most) : 0
      const faster = (now.length() - was.velocity.length()) / gone
      const share = Math.min(1, gone / (TOLD * this.size.beat))
      this.turns += (turned - this.turns) * share
      this.faster += (faster - this.faster) * share
    }
    this.told = { velocity: now, time: this.body.time }
    const { course, led } = mover
    if (speed < STILL * pace) {
      if (led && course.arrive === 0) return
      if (mover.placed) mover.settle(true)
      else mover.send(this.stopping(), true)
    } else {
      const heading = Math.atan2(velocity.x, velocity.z)
      const { turns, faster } = this
      const same = course.heading === heading && course.turns === turns && course.faster === faster
      if (led && same && Math.abs(course.speed) === speed) return
      const push = speed > WALK.most * pace ? RUN.push : WALK.push
      this.lead = { heading, turns, faster, y: mover.height, speed, push, arrive: speed }
      mover.send(this.lead, true)
    }
    this.ahead.stale()
  }

  face(way?: { x: number; z: number }): Story<boolean> {
    if (way && !(Math.hypot(way.x, way.z) > 0)) throw new Error('he is to face a way that leads nowhere')
    const { mover } = this
    const face = way && Math.atan2(way.x, way.z)
    if (face !== mover.face) this.ahead.stale()
    // (how fast it turns, as it is told over one update after another)
    const was = this.faced
    const gone = was ? this.body.time - was.time : 0
    if (face === undefined || !was || gone > this.size.beat) mover.swings = 0
    else if (gone > 0) mover.swings += (wrap(face - was.face) / gone - mover.swings) * Math.min(1, gone / (TOLD * this.size.beat))
    this.faced = face === undefined ? undefined : { face, time: this.body.time }
    this.aimed = face !== undefined
    mover.face = face
    return waits(
      () => true,
      () => this.mover.faced,
    )
  }

  look(place?: Xyz, { over, on }: { over?: Xyz; on?: Object3D } = {}) {
    if (place && !Number.isFinite(place.x + place.y + place.z))
      throw new Error('he is to look at a place no numbers say')
    this.looked = place && new Vector3().copy(place)
    this.over = over && on && { on, at: new Vector3().copy(over) }
    this.ahead.stale()
  }

  knock(velocity: Xyz, at?: Xyz) {
    const { mover, size } = this
    if (![velocity, ...(at ? [at] : [])].every(({ x, y, z }) => Number.isFinite(x + y + z)))
      throw new Error('he is knocked at a place, or set going, as no numbers say')
    const [left, right] = SIDES.map((side) => this.ahead.shoulder(side, 0, new Vector3(), new Quaternion()))
    const lever = (at ? new Vector3().copy(at) : left.lerp(right, 0.5)).sub(this.hips.value)
    const [going, heavy] = [new Vector3().copy(velocity), size.trunk ** 2 + lever.lengthSq()]
    mover.knock(going.clone().multiplyScalar(size.trunk ** 2 / heavy))
    // (a trunk the story turns keeps to that)
    const { trunk } = this.joints
    if (trunk.reacts) trunk.velocity.add(lever.cross(going).divideScalar(heavy).applyAxisAngle(UP, -mover.facing))
    this.ahead.stale()
  }

  /**
   * where he looks so far through the update being made: on the way from where he looked at the end of the last one,
   * as the place to look at is said once an update, for its end
   */
  looking(share: number) {
    const { looked, before } = this
    return looked && before ? before.clone().lerp(looked, share) : looked
  }

  /** the update is made: where he looks now is where he looks from in the next */
  looks() {
    this.before = this.looked?.clone()
  }

  /** how a place lies from his shoulders: about y in the scene, from +z toward +x, and up (rad) */
  sight(place: Vector3) {
    const { x, y, z } = place.clone().sub(this.hips.value)
    return { yaw: Math.atan2(x, z), pitch: Math.atan2(y - this.size.trunk, Math.hypot(x, z)) }
  }

  /**
   * Gives the hips a way to go that ends on a footfall where it ends: the `side` foot's, if it matters which, as near
   * as his strides come out onto it. Tells the story of the way, and the moment it is `over`.
   */
  private plant(course: Course & { z: number; x: number }, place: { x: number; z: number }, side?: Side) {
    const arrives = this.send(course)
    this.mover.plant = { at: course.z, side }
    return { arrives, over: this.when(place) }
  }

  jump(top: Xyz): Story<boolean> {
    const { mover } = this
    if (!(top.y - mover.origin.y > this.size.stand && Number.isFinite(top.x + top.y + top.z))) {
      throw new Error(`a jump goes up: at its top the hips are above the ${this.size.stand.toFixed(2)} m they stand at`)
    }
    mover.spring = { top: mover.local(new Vector3().copy(top)), from: mover.course.z }
    this.ahead.stale()
    return waits(
      () => true,
      () => !mover.jumps,
    )
  }

  stand(free: () => void): Story<boolean> {
    const { mover, joints } = this
    if (mover.jumps) return this.landed(free)
    free()
    for (const part of [joints.trunk, joints.head]) part.free()
    for (const side of SIDES) {
      // (an arm that is swinging out from what its hand was let go from is the body's when it has)
      for (const part of [joints.arms[side].first, joints.arms[side].second]) if (!part.loose) part.free()
    }
    mover.face = this.looked = this.over = this.told = this.faced = undefined
    this.turns = this.faster = mover.swings = 0
    this.reactions.urged.set(0, 0, 0)
    mover.height = this.size.stand
    return this.send(this.stopping(), true)
  }

  private *landed(free: () => void): Story<boolean> {
    yield* waits(
      () => true,
      () => !this.mover.jumps,
    )
    return yield* this.stand(free)
  }

  /** the way to rest for hips that are going: where their speed carries them, or standing already, or coming to rest short of that, where he is to */
  private stopping() {
    const { mover } = this
    const [speed, halt] = [mover.velocity.z, mover.halt]
    const [far, carries] = [(halt ?? Infinity) - mover.value.z, (speed * Math.abs(speed)) / PUSH.along]
    const { pace } = this.size
    const stays = Math.abs(speed) <= SLOW * pace || (far * carries >= 0 && Math.abs(far) < Math.abs(carries))
    const z = halt !== undefined && stays ? halt : mover.value.z + carries
    const fast = Math.sign(speed || 1) * Math.max(Math.abs(speed), WALK.speed * pace)
    return toRest(mover.height, z, fast)
  }

  /**
   * Gives the hips somewhere to go. The story it returns is over when they are at rest there, or when he `stands`
   * there, and gives false if they were given somewhere else to go before that.
   */
  private send(course: Course, stands = false): Story<boolean> {
    const { mover } = this
    const { z = 0, x = 0, y, speed, push, arrive } = course
    const numbers = [z, x, y, speed, push, arrive].every(Number.isFinite)
    if (!numbers || !(course.push > 0)) {
      throw new Error('the hips are sent somewhere, at a speed or pushed so hard, that is no number above 0')
    }
    course.y = held(mover, course.y)
    mover.send(course)
    this.ahead.stale()
    // at rest there, as high as his legs let him, and up again from where a hand or a foot had him down as far as he is to come
    const { leg } = this.size
    const arrived = () =>
      mover.halted &&
      Math.abs(mover.value.y - Math.min(course.y - mover.low, mover.ceiling())) < HIGH * leg &&
      mover.low - mover.stoops.low(mover.time) < THERE * leg
    return waits(
      () => mover.course === course,
      () => arrived() && (!stands || mover.stands),
    )
  }
}
