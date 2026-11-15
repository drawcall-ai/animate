import { Vector3 } from 'three'
import type { Ahead } from './ahead'
import { behind } from './gait'
import { REST } from './goal'
import { type Joints, RANGE } from './joints'
import type { Mover } from './mover'
import { SIDES, SIGN } from './size'
import { LEADS } from './way'
import { GRAVITY, UP, clamp, wrap } from './world'

/**
 * How much of the way the hips are pushed along the trunk leans, how much of the way a leg in the air is swung out it
 * leans against it, and how far it leans forward for the hips riding back: by the angle whose sine is this many
 * times as far as they do, in lengths of his leg, which is what puts as much of his weight ahead of his feet as that
 * puts behind; how far it leans into the way he is going for every pace (rad); how much of his weight the ground counts as pushing up
 * with at the least, for the way it pushes him along to be told from; and how much of the way the pelvis lists it
 * tilts the other way, over the foot he stands on.
 */
const LEAN = { pushed: 0.6, swung: 0.25, back: 2.2, going: 0.059, light: 0.25, listed: 0.5 }
/** how much of the way the trunk leans, turns and tilts the head turns back, to stay level and look ahead */
const LEVEL = new Vector3(-0.6, -1, -1)
/**
 * How an arm swings against the legs: by how much of how far the thighs are apart, at rest and for every pace he
 * goes, and at the most; how far the elbow folds for every pace he goes, squared, and at the most (rad), how much less for every rad
 * the arm is swung back, and how far a forearm hangs folded under an arm that is sent somewhere (rad); and how far
 * forward an arm is thrown for a push up as hard as his weight (rad).
 */
const ARMS = { least: 0.5, faster: 0.44, most: 1.5, folds: 1.3, folded: 1.5, opens: 0.3, hangs: 0.2, thrown: 1.2 }
/** how hard the arms take the legs to push him up, at the least and at the most: in times his weight */
const LIFT = { least: -1, most: 1.2 }
/** how fast the hips rise through the air with the arms as far up as a push as hard as his weight throws them (in his paces) */
const FLUNG = 0.68
const want = new Vector3()
const lean = new Vector3()

/** how far the hips have the trunk lean to his left along the way he is going, as they are: into the turn the ground pushes him round */
const banks = ({ velocity, curves, falls }: Mover) =>
  falls ? 0 : LEAN.pushed * Math.atan2(velocity.z * curves, GRAVITY)

/** how far forward the hips have the trunk lean, facing as he does, and to his left: as far along the way he is going, and across it, as they have it lean */
export const leans = (mover: Mover) => along(mover) * Math.cos(mover.faces) + banks(mover) * Math.sin(mover.faces)
const tilts = (mover: Mover) => banks(mover) * Math.cos(mover.faces) - along(mover) * Math.sin(mover.faces)

/**
 * how far along the way he is going the hips have the trunk lean, as they are: into the way they are pushed and the way
 * he is going, over his feet when they are low behind them, and back against a leg swung out ahead of him, on the
 * ground, where he has to keep his balance: none of the last two between feet the story has put down, which he comes to
 * stand over
 */
function along(mover: Mover) {
  const { value, velocity, acceleration, falls, placed, foot } = mover
  const { leg, pace } = mover.size
  const up = Math.max(GRAVITY * LEAN.light, GRAVITY + acceleration.y)
  const pushed = Math.atan2(falls ? 0 : (value.y / up) * acceleration.z, value.y)
  const over = placed ? 0 : Math.asin(Math.min(1, (LEAN.back * behind(mover.size, value.y)) / leg))
  const out = SIDES.reduce((sum, side) => sum + (foot[side].down || falls || placed ? 0 : mover.points(side)), 0)
  const [least, most] = RANGE.trunk.x
  return clamp(LEAN.pushed * pushed + over + (LEAN.going * velocity.z) / pace - LEAN.swung * out, least, most)
}

/** how far forward he leans who would lean so far `upright`, bent for a hand: at least as far as that needs, however else he would lean */
export const bent = (upright: number, bend: number) =>
  bend > 0 ? Math.max(upright, bend) : Math.min(upright, bend || upright)

/**
 * What the free parts do. The trunk leans as the hips will have it lean by the time it has come round, and back against
 * a leg swung out ahead of it; it turns as the pelvis does and against it with the arms, and winds up for a hand that
 * is to arrive fast; standing at his ease, it leans back with each breath. The head stays level and looks ahead, or
 * where he looks, which the trunk turns toward. An arm hangs from its shoulder and goes with the thigh of
 * the other side, its elbow bent the more the faster he goes, and is thrown the way the legs push the hips.
 */
export class Reactions {
  /** how hard the legs push him up, as the arms have taken it up: in times his weight */
  private lift = 0
  /** how the head is to be turned against the trunk to have his eye on a line he looks along, if it is */
  sights?: Vector3
  /** how fast he is led faster along the ground, in the scene (m/s²): the trunk leans into it */
  readonly urged = new Vector3()

  constructor(
    private readonly mover: Mover,
    private readonly joints: Joints,
    private readonly ahead: Ahead,
  ) {}

  /** the free parts come round to what the rest of him has them do, the hands being sent where they are */
  react(delta: number) {
    const { joints } = this
    const { velocity, acceleration, falls, drops, launch, turn, list, size } = this.mover
    const { trunk, head } = joints
    const fast = Math.abs(velocity.z) / size.pace
    // how far the arms swing against the legs, the left one back: the trunk turns as the pelvis does, and against it with the arms
    const { left, right } = joints.legs
    const swung =
      ((right.first.value.x - left.first.value.x) / 2) * Math.min(ARMS.most, ARMS.least + ARMS.faster * fast)
    // (the trunk turns with the arms by as much of their swing as a shoulder is out from the spine against an arm's
    // length, as far as the arms are free, for an arm the story has holds it to the pelvis; and ahead of the pelvis to
    // face as he is to, whatever the arms hold)
    const { aims, look, facing, face } = this.mover
    const free = SIDES.filter((side) => joints.arms[side].first.reacts).length / SIDES.length
    // (looking somewhere, it turns there however the arms are held, and the body's own turns and leans go on in it:
    // but round off a way he is to face it does not, and the head alone turns from that)
    const looked = this.ahead.gaze()
    const toward = face === undefined ? looked?.y : undefined
    // (led faster, or slower, the trunk leans into it, or back against it, as he would were he pushed so)
    const urged = lean.copy(this.urged).applyAxisAngle(UP, -facing)
    const [ahead, aside] = [urged.z, urged.x].map((by) => LEAN.pushed * Math.atan2(by, GRAVITY))
    want.set(
      this.ahead.leans(delta) + (looked?.x ?? 0) + ahead,
      turn + free * (size.shoulder / size.arm) * swung + (toward ?? clamp(aims, -LEADS.trunk, LEADS.trunk)),
      -LEAN.listed * list - tilts(this.mover) - aside,
    )
    const loose = trunk.loose
    trunk.react(want, delta)
    // (the body's sooner than it had come round, it is not where it was looked ahead to be)
    if (loose && trunk.reacts) this.ahead.stale()
    want.copy(trunk.value).multiply(LEVEL)
    // (and the head looks up or down there whatever the trunk does)
    if (look) want.x = -look.pitch - trunk.value.x
    const lead = look ? wrap(look.yaw - facing) : aims
    head.react(this.sights ?? want.setY(want.y + clamp(lead, -LEADS.head, LEADS.head)), delta)
    const folded = Math.min(ARMS.folded, ARMS.folds * fast * fast)
    // the arms are thrown the way the legs push the hips: back as he sinks, forward and up as he pushes off, and in
    // the air they stay up while he rises and come down as he falls
    const lift = falls ? velocity.y / (FLUNG * size.pace) : drops ? LIFT.least : launch ? acceleration.y / GRAVITY : 0
    // (the push comes on at once; an arm takes it up as it comes round)
    const taken = 1 - Math.exp(-2 * Math.PI * joints.arms.left.first.rate * delta)
    this.lift += (clamp(lift, LIFT.least, LIFT.most) - this.lift) * taken
    const thrown = -ARMS.thrown * this.lift
    for (const side of SIDES) {
      const { first: arm, second: forearm, hand } = joints.arms[side]
      const [forth, rear] = RANGE.arm.x
      // (thrown and swung, a free arm comes up ahead of him no higher than level with its shoulder, nor does its hand)
      const swings = Math.max(-Math.PI / 2, SIGN[side] * swung + thrown) - trunk.value.x
      arm.react(want.set(clamp(swings, forth, rear), 0, 0), delta)
      // the elbow closes as the arm swings forward and opens as it swings back; under an arm that is sent somewhere, a free forearm hangs
      const closes = Math.min(folded * (1 - ARMS.opens * arm.value.x), Math.PI + 2 * (arm.value.x + trunk.value.x))
      const bent = arm.reacts ? Math.max(0, closes) : ARMS.hangs
      forearm.react(want.set(-bent, 0, 0), delta)
      // the trunk is in a free arm's way, whatever swings it: one that is sent somewhere keeps to where it is sent
      if (arm.reacts) joints.arms[side].off(arm.value, forearm.value.x)
      hand.wrist.react(REST, delta)
      hand.fingers?.react(delta)
    }
  }
}
