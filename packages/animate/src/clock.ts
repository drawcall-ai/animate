import type { Object3D, Vector3 } from 'three'
import { type Ahead, type Going, held, type Mover, type Reactions, type Stance } from '@drawcall/locomotion'
import { type Bindings, type Bones, both, type End, type Gives, type Joints, NUDGE, parts, type Side, SIDES, type Size, type Story, tick, UP } from '@drawcall/limbs'

/**
 * how the head is to be turned against the trunk to look at a place, in the scene, over a point `at` on a thing, in its
 * frame: with the eye nearer the line from that point to the place on it
 */
function sighting(bones: Bones, place: Vector3, { on, at }: { on: Object3D; at: Vector3 }) {
  on.updateWorldMatrix(true, false)
  const through = at.clone().applyMatrix4(on.matrixWorld).applyMatrix4(bones.frame)
  const way = place.clone().applyMatrix4(bones.frame).sub(through).normalize()
  const off = (side: Side) => {
    const from = bones.eye(side).sub(through)
    return from.addScaledVector(way, -from.dot(way)).length()
  }
  return bones.sighting(off('right') <= off('left') ? 'right' : 'left', through, way)
}

/** what a step moves: the workings of a body, as it is made of them */
export type Workings = {
  size: Size
  bones: Bones
  mover: Mover
  joints: Joints
  ahead: Ahead
  reactions: Reactions
  gives: Gives
  bindings: Bindings
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
  /** how far each foot is bent toe down against its shin, as it was in the last step (rad) */
  private readonly bent = both(() => 0)
  /** from when until when on his clock the update being made goes on */
  private span = { from: 0, to: 0 }

  constructor(private readonly body: Workings) {}

  update(delta: number) {
    if (!(delta >= 0 && delta < Infinity)) throw new Error(`time goes on by ${delta} s`)
    const dt = tick(this.body.size)
    this.updated = true
    // (the steps go on from him as he is, not as he was drawn ahead of them)
    if (this.owed > 0) this.draw(0)
    this.span = { from: this.time + this.owed, to: this.time + this.owed + delta }
    this.body.going.places(this.span.to)
    this.body.bindings.watch(this.span.to)
    for (this.owed += delta; this.owed >= dt; this.updated = false) {
      this.owed -= dt
      this.advance(dt, this.updated)
    }
    this.body.going.looks()
    // he is drawn as he is at the moment the update is for, between his steps, and so is what his hands hold
    if (this.owed > 0) {
      this.draw(this.owed)
      this.body.gives.write(
        SIDES.map((side) => this.body.ends.hand[side]),
        this.owed,
      )
      this.body.bindings.write(this.time + this.owed)
    }
  }

  private advance(delta: number, frame: boolean) {
    const { mover, joints, ends, ahead, gives, going, reactions, stood } = this.body
    const all = SIDES.flatMap((side) => [ends.foot[side], ends.hand[side]])
    const hands = SIDES.map((side) => ends.hand[side])
    if (frame) gives.begin(this.span)
    // what was to arrive by now has, before the stories go on from it
    // (one sent to a thing that has left his scene is let free, and that is told once the step is done)
    const kept = (end: End, act: () => void) => {
      try {
        act()
      } catch (error) {
        end.free()
        this.faults.push(error)
      }
    }
    for (const end of all) kept(end, () => end.arrive(frame))
    // (what a story throws is thrown once the step is done, and the story is over)
    for (let k = 0; k < this.stories.length; k++) {
      let done = true
      try {
        done = this.stories[k].next().done === true
      } catch (error) {
        this.faults.push(error)
      }
      if (done) this.stories.splice(k--, 1)
    }
    // where he looks is told as it lies from his shoulders now
    const { from, to } = this.span
    const looked = going.looking(to > from ? Math.min(1, (this.time + delta - from) / (to - from)) : 1)
    mover.look = looked && going.sight(looked)
    // the ground moves the hips and the feet. Where a foot the story has is, is told to the ground: and where the ground holds a foot of the body's own, to whoever looks at the foot
    const feet = SIDES.map((side) => [side, ends.foot[side], mover.foot[side]] as const)
    for (const [side, end, foot] of feet) if (end.held) mover.local(end.value, side, foot.at)
    // (he is looked ahead at from before this step, not from the middle of it: his clock goes on at the end of it)
    ahead.at(0)
    // (led, he may be told how high and how fast in either order between two steps: led faster than his hips are held
    // for, he rises as far as that takes)
    if (mover.course.heading !== undefined) {
      mover.height = mover.course.y = held(mover, mover.height, { speed: Math.abs(mover.course.speed) })
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
    reactions.sights = gives.correct(hands, delta, { place: looked, over: going.over }) ?? (looked && going.over && sighting(this.body.bones, looked, going.over))
    for (const end of all) kept(end, () => end.advance(this.time, delta))
    for (const part of parts(joints)) part.advance(delta)
    this.body.bindings.pin()
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
    const { mover, joints, bones, ends, hips, stance, bindings } = this.body
    // (a foot to stay where the hips have gone further from than its leg reaches is let free, for him to step after them)
    for (const side of SIDES) if (stance[side].pose(mover, delta)) ends.foot[side].free()
    mover.scene(mover.value, undefined, hips.value)
    hips.velocity.copy(mover.velocity).applyAxisAngle(UP, mover.heading)
    // where the feet and the hands are, and from where they are a moment on as everything is moving, how they move
    const places = SIDES.flatMap((side) => [
      { end: ends.foot[side], at: bones.ankle[side] },
      { end: ends.hand[side], at: bones.wrist[side] },
    ])
    bones.pose(this.posed(), joints, NUDGE)
    for (const { end, at } of places) end.velocity.copy(at)
    bindings.measure(this.time + delta + NUDGE)
    for (const side of SIDES) {
      const { first: thigh, second: shin } = joints.legs[side]
      this.bent[side] = stance[side].foot(thigh.value.x, shin.value.x, mover.falls, delta)
    }
    this.draw(0)
    for (const { end, at } of places) end.velocity.sub(end.value.copy(at)).divideScalar(NUDGE)
    // (what his hands have goes with them)
    bindings.write(this.time + delta)
  }

  /** the hips as the bones are turned from them */
  private posed() {
    const { mover, hips } = this.body
    const { turn, turning, list, listing, facing, spins } = mover
    const toes = both((side) => mover.heading + mover.foot[side].toes)
    return {
      value: hips.value,
      velocity: hips.velocity,
      turn,
      turning,
      list,
      listing,
      facing,
      spins,
      lifted: mover.breathes,
      toes,
    }
  }

  /** the bones are turned to where everything is `seconds` on from his last step, going as it goes then */
  private draw(seconds: number) {
    const { joints, bones, ends } = this.body
    const posed = this.posed()
    bones.pose(posed, joints, seconds)
    bones.grasp(joints)
    for (const side of SIDES) {
      const { first: thigh, second: shin } = joints.legs[side]
      // (a foot the story has goes with its shin)
      if (ends.foot[side].held) bones.pitch(side, this.bent[side])
      else bones.tread(side, this.bent[side] + thigh.value.x + shin.value.x, posed.toes[side])
    }
  }
}
