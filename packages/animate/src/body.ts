import { type Object3D, Vector3 } from 'three'
import { Ahead } from './ahead'
import { Bones } from './bones'
import { End, type Foot, type Hand } from './end'
import type { Part } from './goal'
import { type Course, PUSH, RIDE, STILL, THERE, TOGETHER, UP, WALK, lowest, toRest } from './hips'
import { type Joints, joints, parts } from './joints'
import { Reactions } from './react'
import { hip, shoulder } from './roots'
import { SLACK } from './limb'
import { SIDES, SIGN, type Side, type Size, both, tick } from './size'
import { Stance } from './stance'
import { Stoops } from './stoop'
import { Mover } from './stride'
import { EXACT, NUDGE, type Story, type Xyz, due, waits } from './world'

/** how low the hips go while he walks along, in shares of how high they stand */
const CROUCH = 0.737
/** how far along z the hips are sent at the most without that being a walk (in lengths of his leg) */
const SPOT = 0.057
/** how fast the hips go at the most while he counts as standing (in his paces) */
const SLOW = 0.1
/** a run: how fast he sprints (in his paces), and how hard a foot on the ground pushes the hips unless it is said (m/s²) */
const RUN = { most: 3.4, push: 5 }
/** a place on the ground: or told as a number, so far along z on x = 0 */
type Ground = number | { x: number; z: number }
const flat = (to: Ground) => (typeof to === 'number' ? { x: 0, z: to } : to)
type Run = { speed: number; at: Ground; plant?: Side; push?: number; arrive?: number }
type Walk = { speed?: number; plant?: Side }
/** how near the speed he is to arrive at a way that ends on a planted foot has to get him, in shares of it */
const NEAR = 0.1

/** how near as high as they were sent the hips count as there (in lengths of his leg) */
const HIGH = 0.034
const spot = new Vector3()
/** how far ahead he is looked at for a moment to come, in his beats */
const LONG = 400

/**
 * A person as joints that turn, which turn the bones of a rigged humanoid. The hips are given somewhere to go, and the
 * feet step under them; the feet and the hands can be sent to places, the trunk, the head and the arms to rotations
 * against what they hang on, rest being none. Every part has its strength, so it takes the time it needs and moves
 * like a thing with weight, and every joint turns only as far as joints do. What is not sent anywhere reacts to what
 * the rest of the body does: the trunk leans into a push and winds up for a fast hand, the arms swing against the legs.
 */
export class Body {
  /** how large he is, as the rig is at rest */
  readonly size: Size
  private readonly bones: Bones
  private readonly mover: Mover
  private readonly joints: Joints
  private readonly ahead: Ahead
  private readonly reactions: Reactions
  private readonly stance: Record<Side, Stance>
  /**
   * the hips: where they are and how they move, `to` a place they go at a walk, or to a height alone, which they are
   * held at wherever he goes, and `at` a place on the ground the world has put them
   */
  readonly hips: Readonly<Record<'value' | 'velocity', Vector3>> & {
    to(target: Xyz | { y: number }, way?: Walk): Story<boolean>
    at(place: { x: number; z: number }): void
  }
  /** what a story sends to rotations (rad about x, y and z), against what each hangs on */
  readonly trunk: Part
  readonly head: Part
  readonly arm: Record<Side, Part>
  readonly forearm: Record<Side, Part>
  private readonly ends: Record<'foot' | 'hand', Record<Side, End>>
  /** what a story sends to places (m) */
  readonly foot: Record<Side, Foot>
  readonly hand: Record<Side, Hand>
  /** where the ground holds each foot of the body's own, while it does */
  private readonly stood = both(() => new Vector3())
  private clock = 0
  /** the seconds it has been updated for that are less than a step yet */
  private owed = 0
  private readonly stories: Story<unknown>[] = []
  /** whether there has been an update since the last step, and what went wrong in the step being made */
  private updated = false
  private readonly faults: unknown[] = []

  /** the body of a rigged humanoid, as it is posed now: its rest pose. Places are told from where the `rig` is, along its axes */
  constructor(rig: Object3D) {
    const bones = (this.bones = new Bones(rig))
    const size = (this.size = bones.size)
    const turning = (this.joints = joints(
      size,
      both((side) => bones.chains(side)),
    ))
    for (const side of SIDES) {
      const { fingers } = turning.arms[side].hand
      if (fingers) bones.hang(side, fingers.grip)
    }
    const mover = (this.mover = new Mover(size, new Stoops(size, turning.trunk)))
    const ahead = (this.ahead = new Ahead(this, mover, turning, bones))
    const reactions = (this.reactions = new Reactions((story) => this.stories.push(story), mover, turning, ahead))
    const rigged = (end: 'foot' | 'hand', side: Side) => ({
      frame: bones.frame,
      rig,
      limb: bones.starts[end][side],
      body: this,
    })
    const foot = both(
      (side) =>
        new End(
          `${side} foot`,
          turning.legs[side],
          hip(side, mover, ahead),
          ahead,
          size,
          rigged('foot', side),
          size.ankle,
        ),
    )
    const hand = both(
      (side) =>
        new End(
          `${side} hand`,
          turning.arms[side],
          shoulder(side, mover, ahead, reactions),
          ahead,
          size,
          rigged('hand', side),
        ),
    )
    this.ends = { foot, hand }
    this.foot = foot
    this.hand = hand
    this.stance = both((side) => new Stance(size, side, turning.legs[side], foot[side], mover.foot[side]))
    this.hips = {
      value: new Vector3(),
      velocity: new Vector3(),
      to: (target, way) => ('x' in target ? this.walkTo(target, way) : this.hold(target.y, way)),
      at: (place) => {
        if (!Number.isFinite(place.x + place.z)) throw new Error('the hips are at a place that no numbers say')
        mover.shift(place)
        this.ahead.stale()
        mover.scene(mover.value, undefined, this.hips.value)
      },
    }
    this.trunk = turning.trunk
    this.head = turning.head
    this.arm = both((side) => turning.arms[side].first)
    this.forearm = both((side) => turning.arms[side].second)
    for (const part of parts(turning)) part.free()
    for (const side of SIDES) foot[side].anchor = this.stood[side].copy(mover.foot[side].at)
    this.pose(0)
  }

  /** the hips go to a place at a walk: one no further off than he shifts his weight where he stands, along the way he is going */
  private walkTo(target: Xyz, { speed = WALK.speed * this.size.pace, plant }: Walk = {}) {
    const { mover } = this
    const { stand, leg, pace } = this.size
    const [most, crouch, spot] = [WALK.most * pace, CROUCH * stand, SPOT * leg]
    if (!(speed > 0 && speed <= most)) {
      throw new Error(
        `the hips are sent somewhere at ${speed} m/s, and he walks at up to ${most.toFixed(2)} m/s: faster, he runs`,
      )
    }
    const to = mover.local(new Vector3().copy(target))
    const [along, far] = [to.z - mover.value.z, Math.hypot(to.x, to.z - mover.value.z)]
    if (target.y < crouch && far > spot) {
      throw new Error(
        `the hips are sent ${far.toFixed(2)} m along at ${target.y.toFixed(2)} m up, and he walks with them no lower than ${crouch.toFixed(2)} m: walk there, then squat`,
      )
    }
    const going = mover.velocity.z
    const stops = (going * going) / PUSH.along
    if (going * along > 0 && stops > far + spot) {
      throw new Error(
        `the hips are sent ${far.toFixed(2)} m on, and going ${Math.abs(going).toFixed(1)} m/s they come to rest no sooner than ${stops.toFixed(2)} m on: send them further, or stand() first`,
      )
    }
    this.reaches(target.y, to.z)
    const course = { z: to.z, x: to.x, y: target.y, speed: (Math.sign(along) || 1) * speed, push: WALK.push, arrive: 0 }
    return plant ? this.plant(course, target, plant).there : this.send(course)
  }

  /**
   * The hips are held so high wherever he goes, until he is told otherwise. The story it returns is over when they
   * are so high, as high as he walks with them going along, and gives false if they were held at another height before.
   */
  private hold(y: number, way?: Walk) {
    const { mover } = this
    const { course } = mover
    if (way) throw new Error('the hips are held at a height, at no speed and on no foot: walk somewhere for that')
    this.within(y)
    this.reaches(y, mover.value.z)
    mover.height = course.y = y
    this.ahead.stale()
    const off = () => mover.value.y + mover.low - y
    const { leg } = this.size
    return waits(
      () => mover.height === y,
      () => off() < HIGH * leg && off() > -(HIGH + RIDE) * leg,
    )
  }

  /** over feet the story has put down the hips go no higher than his legs reach them, or that is an error */
  private reaches(y: number, z: number) {
    const high = this.mover.ceiling(z)
    if (!this.mover.placed || y - high <= HIGH * this.size.leg) return
    throw new Error(
      `the hips are sent ${y.toFixed(2)} m up, and there his legs reach the feet where they were put from no higher than ${high.toFixed(2)} m: send the hips lower, or let the feet free`,
    )
  }

  /**
   * he can go so fast with the hips held so high, or that is an error: going along, no lower than a crouch, and at a
   * run as high as he stands. Led so, he holds them as high as that takes
   */
  private holds(speed: number, led = false) {
    const { mover } = this
    const { height } = mover
    const { stand, pace } = this.size
    const [crouch, runs] = [CROUCH * stand, speed > WALK.most * pace]
    const least = runs ? stand : crouch
    if (speed < STILL * pace || height >= least - 1e-9) return
    if (led) mover.height = mover.course.y = least
    const walks = `walks with them no lower than ${crouch.toFixed(2)} m`
    throw new Error(
      `he is to go ${speed.toFixed(2)} m/s with his hips held ${height.toFixed(2)} m up, and ${runs ? 'runs only standing' : walks}: hold them higher first, hips.to({ y })`,
    )
  }

  /** the place on the ground where a foot stands under its hip, he over a place, facing as he does: where a story puts one down */
  ground(side: Side, to: Ground) {
    const { x, z } = flat(to)
    const { hip, ankle } = this.size
    return new Vector3(SIGN[side] * hip, 0, 0).applyAxisAngle(UP, this.mover.facing).add({ x, y: ankle, z })
  }

  /** which way he faces along the ground, in the scene: what `face` turns him to */
  get facing() {
    return new Vector3(0, 0, 1).applyAxisAngle(UP, this.mover.facing)
  }

  /** the seconds it has gone on for */
  get time() {
    return this.clock
  }

  /** has a story played, beside whatever is playing */
  play(story: Story<unknown>) {
    this.stories.push(story)
  }

  get playing() {
    return this.stories.length > 0
  }

  /** a story that is over at a moment, on the clock of `time` */
  *until(when: number): Story {
    if (Number.isNaN(when)) throw new Error('he is to wait until a moment that is no number')
    while (!due(this.time, when)) yield
  }

  /** the moment the hips come by a place on the ground, going as they are, it on their way: or to rest, where they are to come to rest there */
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
      return (way !== undefined && copy.value.z * way >= there.z * way) || (halts && copy.rests)
    }, LONG * this.size.beat)
    if (seconds !== undefined) return this.time + seconds
    throw new Error(`the hips do not come by (${x.toFixed(2)}, ${z.toFixed(2)}) on the ground, going as they are`)
  }

  /** the moment he is highest in the jump he is making, or in the air, is to make next: on the clock of `time` */
  highest() {
    const past = ({ falls, velocity, spring }: Mover) => falls && velocity.y <= 0 && !spring
    const seconds = this.mover.jumps && !past(this.mover) ? this.ahead.first(past, LONG * this.size.beat) : undefined
    if (seconds === undefined) throw new Error('he is not on his way up: ask after jump()')
    return this.time + seconds
  }

  /**
   * Walks to a place on the ground: he turns to go there, and the hips speed up, keep to `speed` if the way is long
   * enough to get up to it, and ease to rest there, the feet stepping under them. With a foot to `plant`, the strides
   * come out even onto that foot there, and he stays on it, the other where it was. The story it returns is over when
   * he is there.
   */
  walk(to: Ground, way: Walk = {}) {
    return this.hips.to({ ...flat(to), y: this.mover.height }, way)
  }

  /**
   * Runs to where a foot is planted `at` its place on the ground, turning to go there: the `plant` foot, if it
   * matters which. The hips speed up, pushed by each foot on the ground with a `push` (m/s²), and keep to `speed`, and
   * if they are to `arrive` over that foot slower, brake onto the last strides as hard as the legs do. The story it
   * returns is over when the hips are over that foot: `when(at)` tells that moment.
   */
  run({ speed, at, plant, push = RUN.push, arrive = speed }: Run): Story {
    this.holds(speed)
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
    return this.until(this.plant({ z: to.z, x: to.x, y: place.y, speed, push, arrive }, place, plant).over)
  }

  /**
   * He is to be going so: `velocity` is how fast and which way along the ground, in the scene (m/s). He gets up to it
   * and round to it by his own gait, walking or running by how fast it is, and keeps to it until he is told otherwise:
   * at none, he comes to rest where his speed carries him. It takes the place of a walk or a run he is on, a jump he
   * is making he still makes, and he is not brought to a stand for want of a story.
   */
  go(velocity: { x: number; z: number }) {
    const { mover } = this
    const { pace } = this.size
    const [speed, most] = [Math.hypot(velocity.x, velocity.z), RUN.most * pace]
    if (!(speed <= most)) throw new Error(`he is to be going ${speed} m/s, and sprints at ${most.toFixed(1)} m/s`)
    const { course, led } = mover
    if (speed < STILL * pace) {
      if (led && course.arrive === 0) return
      mover.send(this.rest(), true)
    } else {
      const heading = Math.atan2(velocity.x, velocity.z)
      if (led && course.heading === heading && Math.abs(course.speed) === speed) return
      const push = speed > WALK.most * pace ? RUN.push : WALK.push
      mover.send({ heading, y: mover.height, speed, push, arrive: speed }, true)
    }
    this.ahead.stale()
  }

  /**
   * He faces a way along the ground, in the scene, wherever he goes: backwards or sideways rather than turn from it,
   * at a walk. With none he faces the way he goes again. The story it returns is over when he faces so.
   */
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
    const there = this.send(course)
    mover.plant = { at: course.z, side }
    const over = this.when(place)
    const { copy } = this.ahead.look(over - this.time)
    const reached = Math.abs(copy.velocity.z)
    const at = copy.local(spot.set(place.x, 0, place.z)).z
    const off = Math.min(...(side ? [side] : SIDES).map((each) => Math.abs(copy.foot[each].at.z - at)))
    const { leg, pace } = this.size
    const near = Math.max(NEAR * course.arrive, STILL * pace)
    if (Math.abs(reached - course.arrive) <= near && off <= SLACK.place * leg) return { there, over }
    Object.assign(mover, before)
    this.ahead.stale()
    throw new Error(
      `a ${course.arrive ? 'run' : 'walk'} of ${far.toFixed(2)} m gets the hips to ${reached.toFixed(1)} m/s at its end, with ${side ? `the ${side}` : 'a'} foot ${off.toFixed(2)} m from where it is to be planted, not to ${course.arrive} m/s over it: ask for a longer way, less speed or a harder push${side ? ', or leave open which foot' : ''}`,
    )
  }

  /**
   * Jumps for the hips to be at a place at the top of it, up and on the way he is going by then: `highest()` tells
   * that moment. Going to where a run or a walk ends, he drops on the way in and takes off from the footfall there;
   * nearer than that, or standing, he drops at once; in the air, once he has come down. The story it returns is over
   * when he has landed.
   */
  jump(top: Xyz): Story<boolean> {
    const { mover } = this
    if (!(top.y > this.size.stand && Number.isFinite(top.x + top.y + top.z))) {
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

  /**
   * Comes to a stand: whatever the story has is let go, how he is to face with it, and the hips come to rest where
   * their speed carries them, the feet stepping under them and together. Out of the air he comes down first. The
   * story it returns is over when he stands.
   */
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
    mover.face = undefined
    mover.height = this.size.stand
    return this.send(this.rest(), true)
  }

  private *landed(): Story<boolean> {
    yield* waits(
      () => true,
      () => !this.mover.jumps,
    )
    return yield* this.stand()
  }

  /** the way to rest for hips that are going: where their speed carries them, or standing already, or coming to rest short of that, where he is to */
  private rest() {
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
    this.within(course.y)
    mover.send(course)
    this.ahead.stale()
    // at rest there, as high as his legs let him, and up again from where a hand or a foot had him down as far as he is to come
    const { leg } = this.size
    const arrived = () =>
      mover.rests &&
      Math.abs(mover.value.y - Math.min(course.y - mover.low, mover.ceiling())) < HIGH * leg &&
      mover.low - mover.stoops.low(mover.time) < THERE * leg
    return waits(
      () => mover.course === course,
      () => arrived() && (!stands || mover.stands),
    )
  }

  private within(y: number) {
    const [low, stand] = [lowest(this.size), this.size.stand]
    if (y >= low - 1e-9 && y <= stand + 1e-9) return
    throw new Error(`the hips are sent ${y.toFixed(2)} m up, and go only from ${low.toFixed(2)} to ${stand.toFixed(2)}`)
  }

  /**
   * time goes on by `delta` seconds, a step at a time: the stories go on, the hips and the feet go where they are
   * going, the goals come nearer, the free parts react, and the joints turn to where that puts them
   */
  update(delta: number) {
    if (!(delta >= 0 && delta < Infinity)) throw new Error(`time goes on by ${delta} s`)
    const dt = tick(this.size)
    this.updated = true
    for (this.owed += delta; this.owed >= dt; this.updated = false) {
      this.owed -= dt
      this.advance(dt, this.updated)
    }
  }

  /**
   * What cannot be done in a step is an error once the step is done: what it was is given up as `otherwise` says, the
   * rest of the step is made and his clock goes on, and the error is thrown then, once.
   */
  private tried(act: () => void, otherwise?: () => void) {
    try {
      act()
    } catch (error) {
      otherwise?.()
      this.faults.push(error)
    }
  }

  private advance(delta: number, frame: boolean) {
    const { mover, joints, ends } = this
    const all = SIDES.flatMap((side) => [ends.foot[side], ends.hand[side]])
    // what was to arrive by now has, before the stories go on from it
    for (const end of all)
      this.tried(
        () => end.arrive(frame),
        () => end.free(),
      )
    for (let k = 0; k < this.stories.length; k++) {
      let done = true
      this.tried(() => (done = this.stories[k].next().done === true))
      if (done) this.stories.splice(k--, 1)
    }
    // the ground moves the hips and the feet. Where a foot the story has is, is told to the ground: and where the ground holds a foot of the body's own, to whoever looks at the foot
    const feet = SIDES.map((side) => [side, ends.foot[side], mover.foot[side]] as const)
    for (const [side, end, foot] of feet) if (end.held) mover.local(end.value, side, foot.at)
    // (he is looked ahead at from before this step, not from the middle of it: his clock goes on at the end of it)
    this.ahead.look(0)
    // (led, he may be told how high and how fast in either order between two steps)
    if (mover.course.heading !== undefined) this.tried(() => this.holds(Math.abs(mover.course.speed), true))
    mover.advance(delta)
    const { fault } = mover
    if (fault) {
      mover.fault = undefined
      // (fallen, he lands on feet the story has no longer)
      if (mover.falls) for (const side of SIDES) ends.foot[side].free()
      this.faults.push(new Error(fault))
    }
    for (const [side, end, foot] of feet)
      if (!end.held) end.anchor = foot.down ? mover.scene(foot.at, side, this.stood[side]) : undefined
    this.reactions.swing()
    for (const end of all)
      this.tried(
        () => end.advance(this.time, delta),
        () => end.free(),
      )
    for (const part of parts(joints)) part.advance(delta)
    this.reactions.react(delta)
    this.pose(delta)
    this.clock += delta
    const faults = this.faults.splice(0)
    const said = faults.map((fault) => (fault instanceof Error ? fault.message : String(fault)))
    if (faults.length > 1) throw new AggregateError(faults, said.join('\n'))
    if (faults.length) throw faults[0]
  }

  private pose(delta: number) {
    const { mover, joints, bones, ends, hips } = this
    for (const side of SIDES)
      this.tried(
        () => this.stance[side].pose(mover, delta),
        () => ends.foot[side].free(),
      )
    mover.scene(mover.value, undefined, hips.value)
    hips.velocity.copy(mover.velocity).applyAxisAngle(UP, mover.heading)
    const { turn, turning, list, listing, facing, spins } = mover
    const toes = both((side) => mover.heading + mover.foot[side].toes)
    const posed = { value: hips.value, velocity: hips.velocity, turn, turning, list, listing, facing, spins, toes }
    // where the feet and the hands are, and from where they are a moment on as everything is moving, how they move
    const places = SIDES.flatMap((side) => [
      { end: ends.foot[side], at: bones.ankle[side] },
      { end: ends.hand[side], at: bones.wrist[side] },
    ])
    bones.pose(posed, joints, NUDGE)
    for (const { end, at } of places) end.velocity.copy(at)
    bones.pose(posed, joints, 0)
    bones.grasp(joints)
    for (const { end, at } of places) end.velocity.sub(end.value.copy(at)).divideScalar(NUDGE)
    for (const side of SIDES) {
      const { first: thigh, second: shin } = joints.legs[side]
      const bent = this.stance[side].foot(thigh.value.x, shin.value.x, mover.falls, delta)
      // (a foot the story has goes with its shin)
      if (ends.foot[side].held) bones.pitch(side, bent)
      else bones.tread(side, bent + thigh.value.x + shin.value.x, toes[side])
    }
  }
}
