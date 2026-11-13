import { Group, Vector3 } from 'three'
import { Ahead } from './ahead'
import { End, type Foot, type Hand } from './end'
import { Figure } from './figure'
import type { Part } from './goal'
import { type Course, LOW, PUSH, STILL, WALK } from './hips'
import { joints, parts } from './joints'
import { Reactions } from './react'
import { hip, shoulder } from './roots'
import { SIDES, SIZE, STAND, type Side, both } from './size'
import { Stance } from './stance'
import { Stoops } from './stoop'
import { Mover } from './stride'
import { NUDGE, type Story, TICK, type Xyz, due } from './world'

/** how low the hips go while he walks along (m) */
const CROUCH = 0.7
/** how far along z the hips are sent at the most without that being a walk (m) */
const SPOT = 0.05
/** how fast the hips go at the most while he counts as standing (m/s) */
const SLOW = 0.3
/** a run: how fast a man sprints (m/s), and how hard a foot on the ground pushes the hips unless it is said (m/s²) */
const RUN = { most: 10, push: 5 }
type Run = { speed: number; at: number; plant?: Side; push?: number; arrive?: number }
/** how near the speed he is to arrive at a way that ends on a planted foot has to get him, in shares of it, and how near where it is to be planted the foot (m) */
const NEAR = { speed: 0.1, foot: 0.05 }

/** how near as high as they were sent the hips count as there, and how near up again from what he was down for (m) */
const UP = { there: 0.03, risen: 0.01 }
/** how far ahead the hips are looked for at a place they are to come by (s) */
const LONG = 120

/**
 * A person as joints that turn, drawn with three.js. The hips are given somewhere to go, and the feet step under them;
 * the feet and the hands can be sent to places, the trunk, the head and the arms to rotations against what they hang
 * on, rest being none. Every part has its strength, so it takes the time it needs and moves like a thing with weight,
 * and every joint turns only as far as joints do. What is not sent anywhere reacts to what the rest of the body does:
 * the trunk leans into a push and winds up for a fast hand, the arms swing against the legs.
 */
export class Body extends Group {
  /** the hips and the feet under them: what the ground moves */
  private readonly mover = new Mover(new Stoops())
  private readonly joints = joints()
  private readonly figure = new Figure(this)
  private readonly ahead = new Ahead(this, this.mover, this.joints, this.figure)
  private readonly reactions = new Reactions((story) => this.play(story), this.mover, this.joints, this.ahead)
  /** the feet and the hands, as the body moves them */
  private readonly ends = {
    foot: both(
      (side) => new End(`${side} foot`, this.joints.legs[side], hip(side, this.mover, this.ahead), SIZE.ankle),
    ),
    hand: both((side) => {
      const root = shoulder(side, this.mover, this.ahead, this.reactions)
      return new End(`${side} hand`, this.joints.arms[side], root)
    }),
  }
  private readonly stance = both(
    (side) => new Stance(side, this.joints.legs[side], this.ends.foot[side], this.mover.foot[side]),
  )
  /** the hips: where they are and how they move, and `to` a place they go at a walk */
  readonly hips = {
    value: this.mover.value,
    velocity: this.mover.velocity,
    to: (target: Xyz, { speed = WALK.speed, plant }: { speed?: number; plant?: Side } = {}) => {
      if (!(speed > 0 && speed <= WALK.most)) {
        throw new Error(
          `the hips are sent somewhere at ${speed} m/s, and he walks at up to ${WALK.most} m/s: faster, he runs`,
        )
      }
      const far = target.z - this.mover.value.z
      if (target.y < CROUCH && Math.abs(far) > SPOT) {
        throw new Error(
          `the hips are sent ${Math.abs(far).toFixed(2)} m along at ${target.y.toFixed(2)} m up, and he walks with them no lower than ${CROUCH} m: walk there, then squat`,
        )
      }
      const going = this.mover.velocity.z
      const stops = (going * going) / PUSH.along
      if (going * far > 0 && stops > Math.abs(far) + SPOT) {
        throw new Error(
          `the hips are sent ${Math.abs(far).toFixed(2)} m on, and going ${Math.abs(going).toFixed(1)} m/s they come to rest no sooner than ${stops.toFixed(2)} m on: send them further, or stand() first`,
        )
      }
      if (target.x !== 0) throw new Error(`the hips are sent ${target.x} m along x, and he travels along z only`)
      const most = this.mover.ceiling(target.z)
      if (this.mover.placed && target.y - most > UP.there) {
        throw new Error(
          `the hips are sent ${target.y.toFixed(2)} m up, and there his legs reach the feet where they were put from no higher than ${most.toFixed(2)} m: send the hips lower, or let the feet free`,
        )
      }
      const course = { z: target.z, y: target.y, speed: (Math.sign(far) || 1) * speed, push: WALK.push, arrive: 0 }
      return plant ? this.plant(course, plant).there : this.send(course)
    },
  }
  /** what a story sends to rotations (rad about x, y and z), against what each hangs on */
  readonly trunk: Part = this.joints.trunk
  readonly head: Part = this.joints.head
  readonly arm: Record<Side, Part> = both((side) => this.joints.arms[side].first)
  readonly forearm: Record<Side, Part> = both((side) => this.joints.arms[side].second)
  /** what a story sends to places (m) */
  readonly foot: Record<Side, Foot> = this.ends.foot
  readonly hand: Record<Side, Hand> = this.ends.hand
  private clock = 0
  /** the seconds it has been updated for that are less than a step yet */
  private owed = 0
  private readonly stories: Story<unknown>[] = []

  constructor() {
    super()
    for (const part of parts(this.joints)) part.free()
    for (const side of SIDES) this.ends.foot[side].anchor = this.mover.foot[side].at
    this.pose(0)
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

  /** the moment the hips come by a place along z, going as they are: or to rest, where they are to come to rest there */
  when(z: number) {
    const way = Math.sign(z - this.mover.value.z) || 1
    const halts = this.mover.halt === z
    for (let seconds = 0; seconds < LONG; seconds += TICK) {
      const { value, rests } = this.ahead.look(seconds).tick
      if (value.z * way >= z * way || (halts && rests)) return this.time + seconds
    }
    throw new Error(`the hips do not come by ${z.toFixed(2)} m along z, going as they are`)
  }

  /** the moment he is highest in the jump he is making, or in the air, is to make next: on the clock of `time` */
  highest() {
    const { jumps, spring, falls, velocity } = this.mover
    if (!jumps || (falls && velocity.y <= 0 && !spring)) throw new Error('he is not on his way up: ask after jump()')
    for (let seconds = 0; ; seconds += TICK) {
      const tick = this.ahead.look(seconds).tick
      if (tick.falls && tick.velocity.y <= 0 && !tick.spring) return this.time + seconds
    }
  }

  /**
   * Walks along z to a place: the hips speed up, keep to `speed` if the way is long enough to get up to it, and ease
   * to rest there, the feet stepping under them. With a foot to `plant`, the strides come out even onto that foot
   * there, and he stays on it, the other where it was. The story it returns is over when he is there.
   */
  walk(to: number, way: { speed?: number; plant?: Side } = {}) {
    return this.hips.to({ x: 0, y: STAND, z: to }, way)
  }

  /**
   * Runs along z to where a foot is planted `at` its place: the `plant` foot, if it matters which.
   * The hips speed up, pushed by each foot on the ground with a `push` (m/s²), and keep to `speed`, and if they are
   * to `arrive` over that foot slower, brake onto the last strides as hard as the legs do. The story it returns is
   * over when the hips are over that foot: `when(at)` tells that moment.
   */
  run({ speed, at, plant, push = RUN.push, arrive = speed }: Run): Story {
    const far = at - this.mover.value.z
    if (!(speed > 0 && push > 0 && arrive > 0 && Number.isFinite(at))) {
      throw new Error('a run has a place to end at, and a speed, a push and a speed to arrive at above 0')
    }
    if (far <= 0) throw new Error(`a run goes forward, and the hips are ${(-far).toFixed(2)} m past where it is to end`)
    if (arrive > speed) throw new Error(`a run at ${speed} m/s does not arrive at ${arrive} m/s`)
    if (push > PUSH.along) throw new Error(`a run is pushed ${push} m/s², and a leg pushes ${PUSH.along} at the most`)
    if (speed > RUN.most) throw new Error(`a run at ${speed} m/s is faster than a man sprints: ${RUN.most} m/s`)
    return this.until(this.plant({ z: at, y: STAND, speed, push, arrive }, plant).over)
  }

  /**
   * Gives the hips a way to go that ends on a footfall where it ends: the `side` foot's, if it matters which. Going
   * as he will, with only a foot on the ground to push him, the way has to get him there as fast as he is to arrive,
   * and his strides out onto that foot: one that does not is an error, and is not begun. Tells the story of the way,
   * and the moment it is `over`.
   */
  private plant(course: Course & { z: number }, side?: Side) {
    const { mover } = this
    const before = { course: mover.course, plant: mover.plant, spring: mover.spring, sent: mover.sent }
    const there = this.send(course)
    mover.plant = { at: course.z, side }
    const over = this.when(course.z)
    const { velocity, foot } = this.ahead.look(over - this.time).tick
    const reached = Math.abs(velocity.z)
    const off = Math.min(...(side ? [side] : SIDES).map((each) => Math.abs(foot[each].at.z - course.z)))
    const near = Math.max(NEAR.speed * course.arrive, STILL)
    if (Math.abs(reached - course.arrive) <= near && off <= NEAR.foot) return { there, over }
    const far = Math.abs(course.z - mover.value.z)
    Object.assign(mover, before)
    this.ahead.stale()
    throw new Error(
      `a ${course.arrive ? 'run' : 'walk'} of ${far.toFixed(2)} m gets the hips to ${reached.toFixed(1)} m/s at its end, with ${side ? `the ${side}` : 'a'} foot ${off.toFixed(2)} m from where it is to be planted, not to ${course.arrive} m/s over it: ask for a longer way, less speed or a harder push${side ? ', or leave open which foot' : ''}`,
    )
  }

  /**
   * Jumps for the hips to be at a place at the top of it (m, up and along z): `highest()` tells that moment. Going to
   * where a run or a walk ends, he drops on the way in and takes off from the footfall there; nearer than that, or
   * standing, he drops at once; in the air, once he has come down. The story it returns is over when he has landed.
   */
  jump(top: Xyz): Story {
    const { mover } = this
    if (top.x !== 0 || !(top.y > STAND && Number.isFinite(top.y + top.z))) {
      throw new Error(`a jump goes up, and along z only: at its top the hips are above the ${STAND} m they stand at`)
    }
    const spring = { top: new Vector3().copy(top), from: mover.course.z }
    // (what his legs cannot do for it shows as they begin to push: he is stepped on ahead to there now, out of the air first)
    const tried = Object.assign(mover.clone(), { spring: { ...spring } })
    while (tried.aloft) tried.advance(TICK)
    while (!tried.falls) tried.advance(TICK)
    mover.spring = spring
    this.ahead.stale()
    return this.once(() => !mover.jumps)
  }

  /** a story that is over once something holds */
  private *once(holds: () => boolean): Story {
    while (!holds()) yield
  }

  /**
   * Comes to a stand: whatever the story has is let go, and the hips come to rest where their speed carries them,
   * the feet stepping under them and together. Out of the air he comes down first. The story it returns is over
   * when he stands.
   */
  stand(): Story {
    const { mover, joints, ends } = this
    if (mover.jumps)
      return this.after(
        this.once(() => !mover.jumps),
        () => this.stand(),
      )
    for (const part of [joints.trunk, joints.head]) part.free()
    for (const side of SIDES) {
      ends.hand[side].free()
      ends.foot[side].free()
      // (an arm that is swinging out from what its hand was let go from is the body's when it has)
      for (const part of [joints.arms[side].first, joints.arms[side].second]) if (!part.loose) part.free()
    }
    const [speed, halt] = [mover.velocity.z, mover.halt]
    // going, the hips come to rest where their speed carries them: standing already, or coming to rest short of that, where he is to
    const [far, carries] = [(halt ?? Infinity) - mover.value.z, (speed * Math.abs(speed)) / PUSH.along]
    const stays = Math.abs(speed) <= SLOW || (far * carries >= 0 && Math.abs(far) < Math.abs(carries))
    const z = halt !== undefined && stays ? halt : mover.value.z + carries
    const pace = Math.sign(speed || 1) * Math.max(Math.abs(speed), WALK.speed)
    const there = this.send({ z, y: STAND, speed: pace, push: PUSH.along, arrive: 0 })
    return this.after(there, () => this.once(() => mover.stands))
  }

  /** a story, and once it is over another, begun then */
  private *after(first: Story<unknown>, then: () => Story): Story {
    yield* first
    yield* then()
  }

  /**
   * Gives the hips somewhere to go. The story it returns is over when they are at rest there, and gives false if
   * they were given somewhere else to go before that.
   */
  private send(course: Course): Story<boolean> {
    const { mover } = this
    const numbers = [course.z ?? 0, course.y, course.speed, course.push, course.arrive].every(Number.isFinite)
    if (!numbers || !(course.push > 0)) {
      throw new Error('the hips are sent somewhere, at a speed or pushed so hard, that is no number above 0')
    }
    if (course.y < LOW || course.y > STAND + 1e-9) {
      throw new Error(
        `the hips are sent ${course.y.toFixed(2)} m up, and go only from ${LOW.toFixed(2)} to ${STAND.toFixed(2)}`,
      )
    }
    mover.send(course)
    this.ahead.stale()
    return this.arrival(course)
  }

  private *arrival(course: Course): Story<boolean> {
    const { mover } = this
    // at rest there, as high as his legs let him, and up again from where a hand or a foot had him down as far as he is to come
    const arrived = () =>
      mover.rests &&
      Math.abs(mover.value.y - Math.min(course.y - mover.low, mover.ceiling())) < UP.there &&
      mover.low - mover.stoops.low(mover.time) < UP.risen
    while (mover.course === course && !arrived()) yield
    return mover.course === course
  }

  /** time goes on by `delta` seconds, a step at a time: the stories go on, the hips and the feet go where they are going, the goals come nearer, the free parts react, and the joints turn to where that puts them */
  update(delta: number) {
    if (!(delta >= 0 && delta < Infinity)) throw new Error(`time goes on by ${delta} s`)
    for (this.owed += delta; this.owed >= TICK; this.owed -= TICK) this.advance(TICK)
  }

  private advance(delta: number) {
    const { mover, joints, ends } = this
    // what was to arrive by now has, before the stories go on from it
    for (const side of SIDES) for (const end of [ends.foot[side], ends.hand[side]]) end.arrive()
    for (let k = 0; k < this.stories.length; k++) if (this.stories[k].next().done) this.stories.splice(k--, 1)
    // with no story left he comes to a stand
    if (this.stories.length === 0 && !mover.stands) this.play(this.stand())
    // the ground moves the hips and the feet. Where a foot the story has is, is told to the ground: and where the ground holds a foot of the body's own, to whoever looks at the foot
    const feet = SIDES.map((side) => [ends.foot[side], mover.foot[side]] as const)
    for (const [end, foot] of feet) if (end.held) foot.at.copy(end.value)
    // (he is looked ahead at from before this step, not from the middle of it: his clock goes on at the end of it)
    this.ahead.look(0)
    mover.advance(delta)
    for (const [end, foot] of feet) if (!end.held) end.anchor = foot.down ? foot.at : undefined
    this.reactions.swing()
    for (const side of SIDES) {
      ends.foot[side].advance(this.time, delta)
      ends.hand[side].advance(this.time, delta)
    }
    for (const part of parts(joints)) part.advance(delta)
    this.reactions.react(delta)
    this.pose(delta)
    this.clock += delta
  }

  /** the joints turn to where the feet, the hands and the goals have them, and the feet and the hands are told where that puts them */
  private pose(delta: number) {
    const { mover, joints, figure, ends } = this
    for (const side of SIDES) this.stance[side].pose(mover, delta)
    // where the feet and the hands are, and from where they are a moment on as everything is moving, how they move
    figure.pose(mover, joints, NUDGE)
    for (const side of SIDES) {
      ends.foot[side].velocity.copy(figure.ankle(side))
      ends.hand[side].velocity.copy(figure.wrist(side))
    }
    figure.pose(mover, joints, 0)
    for (const side of SIDES) {
      const [foot, hand] = [ends.foot[side], ends.hand[side]]
      foot.velocity.sub(foot.value.copy(figure.ankle(side))).divideScalar(NUDGE)
      hand.velocity.sub(hand.value.copy(figure.wrist(side))).divideScalar(NUDGE)
      const { thigh, shin } = figure.legs[side]
      figure.legs[side].foot.rotation.x = this.stance[side].foot(thigh.rotation.x, shin.rotation.x, mover.falls, delta)
    }
  }
}
