import { Vector3 } from 'three'
import { type Bones, both, type Carrier, type End, type Joints, type Side, SIDES, type Story, UP } from '@drawcall/limbs'
import { Ahead } from './ahead'
import { carrier } from './carrier'
import { foresee } from './foresee'
import { Going } from './going'
import { held } from './heights'
import { Mover } from './mover'
import { Reactions } from './reactions'
import { Stance } from './stance'
import { Stoops } from './stoops'

/** the clock he goes by: the seconds it has gone on for, and a story over at a moment on it */
type Clock = { readonly time: number; until(when: number): Story }

/**
 * The hips and the feet under them, the legs that stand on them and the free trunk and arms reacting, going as a
 * story or the player has him go: what the layer above steps, a step of time at a time, and reads the hips' pose and
 * the feet from. `going` takes what is said of where he goes, `carrier` is what the limb planner asks of him.
 */
export class Locomotion {
  /** where the hips are and how they move, in the scene */
  readonly hips = { value: new Vector3(), velocity: new Vector3() }
  readonly going: Going
  readonly carrier: Carrier
  private readonly mover: Mover
  private readonly ahead: Ahead
  private readonly reactions: Reactions
  private readonly stance: Record<Side, Stance>
  /** where the ground holds each foot of his own, while it does */
  private readonly stood = both(() => new Vector3())

  constructor(
    clock: Clock,
    bones: Bones,
    private readonly joints: Joints,
  ) {
    const { size } = bones
    const mover = (this.mover = new Mover(size, new Stoops(size, joints.trunk)))
    const ahead = (this.ahead = new Ahead(clock, mover, joints, bones))
    this.reactions = new Reactions(mover, joints, ahead)
    this.carrier = carrier(mover, ahead)
    this.going = new Going(clock, size, mover, ahead, joints, this.reactions, this.hips)
    this.stance = both((side) => new Stance(size, side, joints.legs[side], mover.foot[side]))
  }

  /** which way he faces in the scene (rad about y, from +z toward +x), and how high the ground under him is (m) */
  get facing() {
    return this.mover.facing
  }

  get ground() {
    return this.mover.origin.y
  }

  /** whether he is in the air, with nothing to push him */
  get falls() {
    return this.mover.falls
  }

  /** where a foot of his own stands on the ground, in the scene: the place the ground holds it, while it does */
  stands(side: Side) {
    const { foot } = this.mover
    return foot[side].down ? this.mover.scene(foot[side].at, side, this.stood[side]) : undefined
  }

  /**
   * A step of time for the hips and the feet: where a foot the story has is, is told to the ground, he looks where he
   * is to, and he goes as he is to go; a foot of his own the ground holds is anchored there. Tells what went wrong,
   * and a wind-up for a fast hand that is to begin now, as a story for the body to play.
   */
  step(dt: number, feet: Record<Side, End>, looked?: Vector3) {
    const { mover, ahead } = this
    mover.look = looked && this.going.sight(looked)
    for (const side of SIDES) if (feet[side].held) mover.local(feet[side].value, side, mover.foot[side].at)
    // (he is looked ahead at from before this step, not from the middle of it: his clock goes on at the end of it)
    ahead.at(0)
    // (led, he may be told how high and how fast in either order between two steps: led faster than his hips are held
    // for, he rises as far as that takes)
    const { course } = mover
    if (course.heading !== undefined) mover.height = course.y = held(mover, mover.height, { speed: Math.abs(course.speed) })
    mover.advance(dt)
    const said = mover.fault
    mover.fault = undefined
    // (fallen, he lands on feet the story has no longer)
    if (said && mover.falls) for (const side of SIDES) feet[side].free()
    for (const side of SIDES) if (!feet[side].held) feet[side].anchor = this.stands(side)
    return { fault: said === undefined ? undefined : new Error(said), wind: ahead.wind.start() }
  }

  /** the free parts come round to what the rest of him has them do */
  react(dt: number) {
    this.reactions.react(dt)
  }

  /** the legs reach for the feet from where the hips are, and the hips are told in the scene: a foot to stay where the hips have gone further from than its leg reaches is let free, for him to step after them */
  pose(delta: number, feet: Record<Side, End>) {
    const { mover, hips } = this
    for (const side of SIDES) if (this.stance[side].pose(mover, feet[side], delta)) feet[side].free()
    mover.scene(mover.value, undefined, hips.value)
    hips.velocity.copy(mover.velocity).applyAxisAngle(UP, mover.heading)
  }

  /** how far a foot is bent toe down against its shin, as its leg is turned now (rad) */
  tread(side: Side, foot: End, delta: number) {
    const { first: thigh, second: shin } = this.joints.legs[side]
    return this.stance[side].foot(foot, thigh.value.x, shin.value.x, this.mover.falls, delta)
  }

  /** the hips as the bones are turned from them: where, the pelvis turned and listing and how fast, which way he faces and each foot points, and how far his breath lifts him */
  posed() {
    const { mover, hips } = this
    const { turn, turning, list, listing, facing, spins } = mover
    const toes = both((side) => mover.heading + mover.foot[side].toes)
    return { value: hips.value, velocity: hips.velocity, turn, turning, list, listing, facing, spins, lifted: mover.breathes, toes }
  }

  /** what the hips and the feet are to do for so many `seconds` on, told in the scene and changing nothing of him */
  foresee(seconds: number) {
    return foresee(this.mover, seconds)
  }

  /** he stands at his ease where he is, letting go of all a story had him do with `free`, once he is on the ground */
  stand(free: () => void) {
    return this.going.stand(free)
  }
}
