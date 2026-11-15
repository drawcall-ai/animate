import { type Object3D, Quaternion, Vector3 } from 'three'
import type { Ahead } from './ahead'
import type { Body } from './body'
import type { End } from './end'
import { HIGH, PUSH, RIDE, RUN, SLOW, SPOT, STILL, THERE, TOGETHER, WALK } from './gait'
import { carries, reaches, walks, within } from './heights'
import type { Joints } from './joints'
import { SLACK } from './limb'
import type { Mover } from './mover'
import { type Course, toRest } from './pelvis'
import type { Reactions } from './reactions'
import { SIDES, type Side, type Size, tick } from './size'
import { EXACT, GRAVITY, type Story, type Xyz, UP, waits } from './world'

/** a place on the ground: or told as a number, so far along z on x = 0 */
export type Ground = number | { x: number; z: number }
export const flat = (to: Ground) => (typeof to === 'number' ? { x: 0, z: to } : to)
export type Run = { speed: number; at: Ground; plant?: Side; push?: number; arrive?: number }
export type Walk = { speed?: number; plant?: Side }
/** how near the speed he is to arrive at a way that ends on a planted foot has to get him, in shares of it */
const NEAR = 0.1
/** how far ahead he is looked at for a moment to come, in his beats */
const LONG = 400
const spot = new Vector3()

/**
 * Where he goes, which way he faces and where he looks: what a story or a game says of that, as the body's statements
 * of the same names, given to the hips as a way to go and checked as it is given.
 */
export class Going {
  /** the place he looks at, if he does, and the point of a thing he looks over at it */
  looked?: Vector3
  over?: { on: Object3D; at: Vector3 }
  /** how he was last led to go along the ground, and when: the change of it is how he is urged on */
  private told?: { velocity: Vector3; time: number }

  constructor(
    private readonly body: Body,
    private readonly size: Size,
    private readonly mover: Mover,
    private readonly ahead: Ahead,
    private readonly joints: Joints,
    private readonly ends: Record<'foot' | 'hand', Record<Side, End>>,
    private readonly reactions: Reactions,
    private readonly hips: Readonly<Record<'value' | 'velocity', Vector3>>,
  ) {}

  /** the hips go to a place at a walk, or are held at a height */
  to(target: Xyz | { y: number }, way?: Walk) {
    return 'x' in target ? this.walkTo(target, way) : this.height(target.y, way)
  }

  /** the hips are at a place on the ground now, where the world has put them, and the ground there is as high as its y */
  at(place: { x: number; y?: number; z: number }) {
    const { mover } = this
    if (!Number.isFinite(place.x + place.z + (place.y ?? 0)))
      throw new Error('the hips are at a place that no numbers say')
    if (place.y !== undefined) mover.floor(place.y)
    mover.shift(place)
    this.ahead.stale()
    mover.scene(mover.value, undefined, this.hips.value)
  }

  /** the hips go to a place at a walk: one no further off than he shifts his weight where he stands, along the way he is going */
  private walkTo(target: Xyz, { speed = WALK.speed * this.size.pace, plant }: Walk = {}) {
    const { mover } = this
    const { leg, pace } = this.size
    const [most, spot] = [WALK.most * pace, SPOT * leg]
    if (!(speed > 0 && speed <= most)) {
      throw new Error(
        `the hips are sent somewhere at ${speed} m/s, and he walks at up to ${most.toFixed(2)} m/s: faster, he runs`,
      )
    }
    const to = mover.local(new Vector3().copy(target))
    const [along, far] = [to.z - mover.value.z, Math.hypot(to.x, to.z - mover.value.z)]
    walks(this.size, target.y, far)
    const going = mover.velocity.z
    const stops = (going * going) / PUSH.along
    if (going * along > 0 && stops > far + spot) {
      throw new Error(
        `the hips are sent ${far.toFixed(2)} m on, and going ${Math.abs(going).toFixed(1)} m/s they come to rest no sooner than ${stops.toFixed(2)} m on: send them further, or stand() first`,
      )
    }
    reaches(mover, target.y, to.z)
    const course = { z: to.z, x: to.x, y: target.y, speed: (Math.sign(along) || 1) * speed, push: WALK.push, arrive: 0 }
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
    within(this.size, y)
    reaches(mover, y, mover.value.z)
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
    if (seconds !== undefined) return this.body.time + seconds
    throw new Error(`the hips do not come by (${x.toFixed(2)}, ${z.toFixed(2)}) on the ground, going as they are`)
  }

  highest() {
    const past = ({ falls, velocity, spring }: Mover) => falls && velocity.y <= 0 && !spring
    const seconds = this.mover.jumps && !past(this.mover) ? this.ahead.first(past, LONG * this.size.beat) : undefined
    if (seconds === undefined) throw new Error('he is not on his way up: ask after jump()')
    return this.body.time + seconds
  }

  walk(to: Ground, way: Walk = {}) {
    return this.to({ ...flat(to), y: this.mover.height }, way)
  }

  run({ speed, at, plant, push = RUN.push, arrive = speed }: Run): Story {
    carries(this.size, speed, this.mover.height)
    const place = { ...flat(at), y: this.size.stand }
    const to = this.mover.local(new Vector3().copy(place))
    if (!(speed > 0 && push > 0 && arrive > 0 && Number.isFinite(to.x + to.z))) {
      throw new Error('a run has a place to end at, and a speed, a push and a speed to arrive at above 0')
    }
    if (arrive > speed) throw new Error(`a run at ${speed} m/s does not arrive at ${arrive} m/s`)
    if (push > PUSH.along) throw new Error(`a run is pushed ${push} m/s², and a leg pushes ${PUSH.along} at the most`)
    const most = RUN.most * this.size.pace
    if (speed > most) throw new Error(`a run at ${speed} m/s is faster than he sprints: ${most.toFixed(1)} m/s`)
    this.forward(speed, this.mover.face)
    return this.body.until(this.plant({ z: to.z, x: to.x, y: place.y, speed, push, arrive }, place, plant).over)
  }

  go(velocity: { x: number; y?: number; z: number }) {
    const { mover } = this
    const { pace } = this.size
    const [speed, most] = [Math.hypot(velocity.x, velocity.z), RUN.most * pace]
    if (!(speed <= most)) throw new Error(`he is to be going ${speed} m/s, and sprints at ${most.toFixed(1)} m/s`)
    // (how fast he is led faster, or slower, no harder than his legs push, as it has been over the last beat)
    const now = new Vector3(velocity.x, 0, velocity.z)
    const was = this.told
    if (was && this.body.time > was.time) {
      const gone = this.body.time - was.time
      const urged = now.clone().sub(was.velocity).divideScalar(gone).clampLength(0, PUSH.along)
      this.reactions.urged.lerp(urged, Math.min(1, gone / this.size.beat))
    }
    this.told = { velocity: now, time: this.body.time }
    if (velocity.y !== undefined && velocity.y > STILL * pace && !mover.jumps) this.leave(velocity.y)
    const { course, led } = mover
    if (speed < STILL * pace) {
      if (led && course.arrive === 0) return
      mover.send(this.stopping(), true)
    } else {
      const heading = Math.atan2(velocity.x, velocity.z)
      if (led && course.heading === heading && Math.abs(course.speed) === speed) return
      const push = speed > WALK.most * pace ? RUN.push : WALK.push
      mover.send({ heading, y: mover.height, speed, push, arrive: speed }, true)
    }
    this.ahead.stale()
  }

  /**
   * he jumps to leave the ground going up so fast (m/s), on the way he is going: the top is as high as that carries
   * him, and as far on as his speed does by then, the push before it a beat
   */
  private leave(up: number) {
    const { value, velocity } = this.hips
    const rises = up / GRAVITY + this.size.beat
    const top = new Vector3(velocity.x, 0, velocity.z).multiplyScalar(rises).add(value)
    this.jump(top.setY(this.mover.origin.y + this.size.stand + (up * up) / (2 * GRAVITY)))
  }

  face(way?: { x: number; z: number }): Story<boolean> {
    if (way && !(Math.hypot(way.x, way.z) > 0)) throw new Error('he is to face a way that leads nowhere')
    const face = way && Math.atan2(way.x, way.z)
    if (!this.mover.led) this.forward(this.mover.course.speed, face)
    if (face !== this.mover.face) this.ahead.stale()
    this.mover.face = face
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

  /** how a place lies from his shoulders: about y in the scene, from +z toward +x, and up (rad) */
  sight(place: Vector3) {
    const { x, y, z } = place.clone().sub(this.hips.value)
    return { yaw: Math.atan2(x, z), pitch: Math.atan2(y - this.size.trunk, Math.hypot(x, z)) }
  }

  /** faster than he walks he faces the way he goes: a way to `face` stated with that is an error */
  private forward(speed: number, face?: number) {
    const most = WALK.most * this.size.pace
    if (face === undefined || Math.abs(speed) <= most) return
    throw new Error(
      `he is to face a way and to go ${Math.abs(speed).toFixed(1)} m/s, and faster than he walks, ${most.toFixed(2)} m/s, he faces the way he goes: let the way he faces go, face(), or have him walk`,
    )
  }

  /**
   * Gives the hips a way to go that ends on a footfall where it ends: the `side` foot's, if it matters which. Going
   * as he will, with only a foot on the ground to push him, the way has to get him there as fast as he is to arrive,
   * and his strides out onto that foot: one that does not is an error, and is not begun. Tells the story of the way,
   * and the moment it is `over`.
   */
  private plant(course: Course & { z: number; x: number }, place: { x: number; z: number }, side?: Side) {
    const { mover } = this
    const { course: was, plant, spring, sent, led } = mover
    const before = { course: was, plant, spring, sent, led }
    const far = Math.hypot(course.x, course.z - mover.value.z)
    const arrives = this.send(course)
    mover.plant = { at: course.z, side }
    const over = this.when(place)
    const { copy } = this.ahead.at(over - this.body.time)
    const reached = Math.abs(copy.velocity.z)
    const at = copy.local(spot.set(place.x, 0, place.z)).z
    const off = Math.min(...(side ? [side] : SIDES).map((each) => Math.abs(copy.foot[each].at.z - at)))
    const { leg, pace } = this.size
    const near = Math.max(NEAR * course.arrive, STILL * pace)
    if (Math.abs(reached - course.arrive) <= near && off <= SLACK.place * leg) return { arrives, over }
    Object.assign(mover, before)
    this.ahead.stale()
    throw new Error(
      `a ${course.arrive ? 'run' : 'walk'} of ${far.toFixed(2)} m gets the hips to ${reached.toFixed(1)} m/s at its end, with ${side ? `the ${side}` : 'a'} foot ${off.toFixed(2)} m from where it is to be planted, not to ${course.arrive} m/s over it: ask for a longer way, less speed or a harder push${side ? ', or leave open which foot' : ''}`,
    )
  }

  jump(top: Xyz): Story<boolean> {
    const { mover } = this
    if (!(top.y - mover.origin.y > this.size.stand && Number.isFinite(top.x + top.y + top.z))) {
      throw new Error(`a jump goes up: at its top the hips are above the ${this.size.stand.toFixed(2)} m they stand at`)
    }
    const spring = () => ({ top: mover.local(new Vector3().copy(top)), from: mover.course.z })
    // (what his legs cannot do for it shows as they begin to push: he is stepped on ahead to there now, out of the air first)
    const trial = Object.assign(mover.clone(), { spring: spring() })
    while (trial.aloft && !trial.fault) trial.advance(tick(this.size))
    while (!trial.falls && !trial.fault) trial.advance(tick(this.size))
    if (trial.fault) throw new Error(trial.fault)
    mover.spring = spring()
    this.ahead.stale()
    return waits(
      () => true,
      () => !mover.jumps,
    )
  }

  stand(): Story<boolean> {
    const { mover, joints, ends } = this
    if (mover.jumps) return this.landed()
    for (const part of [joints.trunk, joints.head]) part.free()
    for (const side of SIDES) {
      ends.hand[side].free()
      ends.foot[side].free()
      // (an arm that is swinging out from what its hand was let go from is the body's when it has)
      for (const part of [joints.arms[side].first, joints.arms[side].second]) if (!part.loose) part.free()
    }
    mover.face = this.looked = this.over = this.told = undefined
    this.reactions.urged.set(0, 0, 0)
    mover.height = this.size.stand
    return this.send(this.stopping(), true)
  }

  private *landed(): Story<boolean> {
    yield* waits(
      () => true,
      () => !this.mover.jumps,
    )
    return yield* this.stand()
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
    within(this.size, course.y)
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
