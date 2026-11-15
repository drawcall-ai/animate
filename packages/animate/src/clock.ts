import type { Vector3 } from 'three'
import type { Ahead } from './ahead'
import type { Bones } from './bones'
import type { End } from './end'
import type { Gives } from './gives'
import type { Going } from './going'
import { carried, least } from './heights'
import { type Joints, parts } from './joints'
import type { Mover } from './mover'
import type { Reactions } from './reactions'
import { SIDES, type Side, type Size, both, tick } from './size'
import type { Stance } from './stance'
import { NUDGE, type Story, UP } from './world'

/** what a step moves: the workings of a body, as it is made of them */
export type Workings = {
  size: Size
  bones: Bones
  mover: Mover
  joints: Joints
  ahead: Ahead
  reactions: Reactions
  gives: Gives
  going: Going
  ends: Record<'foot' | 'hand', Record<Side, End>>
  stance: Record<Side, Stance>
  /** where the ground holds each foot of the body's own, while it does */
  stood: Record<Side, Vector3>
  hips: Readonly<Record<'value' | 'velocity', Vector3>>
}

/**
 * The body's time, which goes on a step at a time however it is updated: in each the stories go on, the hips and the
 * feet go where they are going, the ends are aimed, the free parts react, and the bones are turned.
 */
export class Clock {
  /** the seconds it has gone on for, and those it has been updated for that are less than a step yet */
  time = 0
  private owed = 0
  readonly stories: Story<unknown>[] = []
  /** whether there has been an update since the last step, and what went wrong in the step being made */
  private updated = false
  private readonly faults: unknown[] = []

  constructor(private readonly body: Workings) {}

  update(delta: number) {
    if (!(delta >= 0 && delta < Infinity)) throw new Error(`time goes on by ${delta} s`)
    const dt = tick(this.body.size)
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
    const { mover, joints, ends, ahead, gives, going, reactions, size, stood } = this.body
    const all = SIDES.flatMap((side) => [ends.foot[side], ends.hand[side]])
    const hands = SIDES.map((side) => ends.hand[side])
    if (frame) gives.begin(hands)
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
    // where he looks is told as it lies from his shoulders now
    mover.look = going.looked && going.sight(going.looked)
    // the ground moves the hips and the feet. Where a foot the story has is, is told to the ground: and where the ground holds a foot of the body's own, to whoever looks at the foot
    const feet = SIDES.map((side) => [side, ends.foot[side], mover.foot[side]] as const)
    for (const [side, end, foot] of feet) if (end.held) mover.local(end.value, side, foot.at)
    // (he is looked ahead at from before this step, not from the middle of it: his clock goes on at the end of it)
    ahead.at(0)
    // (led, he may be told how high and how fast in either order between two steps: led faster than his hips are held
    // for, he rises as far as that takes, and is told so once)
    const speed = Math.abs(mover.course.speed)
    const wrong = mover.course.heading === undefined ? undefined : carried(size, speed, mover.height)
    if (wrong) {
      mover.height = mover.course.y = least(size, speed)
      this.faults.push(new Error(wrong))
    }
    mover.advance(delta)
    const { fault } = mover
    if (fault) {
      mover.fault = undefined
      // (fallen, he lands on feet the story has no longer)
      if (mover.falls) for (const side of SIDES) ends.foot[side].free()
      this.faults.push(new Error(fault))
    }
    for (const [side, end, foot] of feet)
      if (!end.held) end.anchor = foot.down ? mover.scene(foot.at, side, stood[side]) : undefined
    const swing = ahead.wind.start()
    if (swing) this.stories.push(swing)
    // (looking over a thing, his head comes down to the line it has his eye on)
    reactions.sights = gives.correct(hands, delta, { place: going.looked, over: going.over })
    for (const end of all)
      this.tried(
        () => this.faults.push(...end.advance(this.time, delta)),
        () => end.free(),
      )
    for (const part of parts(joints)) part.advance(delta)
    reactions.react(delta)
    this.pose(delta)
    gives.write(hands, delta)
    this.time += delta
    const faults = this.faults.splice(0)
    const said = faults.map((fault) => (fault instanceof Error ? fault.message : String(fault)))
    if (faults.length > 1) throw new AggregateError(faults, said.join('\n'))
    if (faults.length) throw faults[0]
  }

  pose(delta: number) {
    const { mover, joints, bones, ends, hips, stance } = this.body
    for (const side of SIDES)
      this.tried(
        () => stance[side].pose(mover, delta),
        () => ends.foot[side].free(),
      )
    mover.scene(mover.value, undefined, hips.value)
    hips.velocity.copy(mover.velocity).applyAxisAngle(UP, mover.heading)
    const { turn, turning, list, listing, facing, spins } = mover
    const toes = both((side) => mover.heading + mover.foot[side].toes)
    const lifted = mover.breathes
    const posed = {
      value: hips.value,
      velocity: hips.velocity,
      turn,
      turning,
      list,
      listing,
      facing,
      spins,
      lifted,
      toes,
    }
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
      const bent = stance[side].foot(thigh.value.x, shin.value.x, mover.falls, delta)
      // (a foot the story has goes with its shin)
      if (ends.foot[side].held) bones.pitch(side, bent)
      else bones.tread(side, bent + thigh.value.x + shin.value.x, toes[side])
    }
  }
}
