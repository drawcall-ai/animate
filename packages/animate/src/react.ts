import { Vector3 } from 'three'
import type { Ahead, Wound } from './ahead'
import { AXES, cubic } from './curve'
import { REST } from './goal'
import { UP, WOUND, behind } from './hips'
import { type Joints, RANGE } from './joints'
import { sway } from './plan'
import { SIDES, SIGN, type Side, tick } from './size'
import type { Mover } from './stride'
import { GRAVITY, NUDGE, type Story, clamp, due } from './world'

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
/** how far ahead of the pelvis the trunk turns at the most, and the head, to face as he is to before his feet have him round, or while his pelvis is turned to the way he goes (rad) */
const LEADS = { trunk: 0.8, head: 1.2 }
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
/** how many times heavier than an arm is to swing the trunk is to lean, to turn about its length, as lightly as an arm swings, and to tilt */
const WEIGHT = new Vector3(12, 1, 12)
/** how finely an arm is held off the trunk (rad) */
const HAIR = 0.002
const want = new Vector3()
const hips = new Vector3()
const lean = new Vector3()
const velocity = new Vector3()

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
 * is to arrive fast. The head stays level and looks ahead. An arm hangs from its shoulder and goes with the thigh of
 * the other side, its elbow bent the more the faster he goes, and is thrown the way the legs push the hips.
 */
export class Reactions {
  /** how hard the legs push him up, as the arms have taken it up: in times his weight */
  private lift = 0
  /** the swing the trunk is making into a fast hand, while it is: the body's own, which a later one takes over */
  private swinging?: Wound

  constructor(
    private readonly play: (story: Story) => void,
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
    // length, and ahead of the pelvis into a turn he is making: as far as the arms are free, for an arm the story has
    // holds it to the pelvis)
    const { aims } = this.mover
    const free = SIDES.filter((side) => joints.arms[side].first.reacts).length / SIDES.length
    want.set(
      this.ahead.leans(delta),
      turn + free * ((size.shoulder / size.arm) * swung + clamp(aims, -LEADS.trunk, LEADS.trunk)),
      -LEAN.listed * list - tilts(this.mover),
    )
    const loose = trunk.loose
    trunk.react(want, delta)
    // (the body's sooner than it had come round, it is not where it was looked ahead to be)
    if (loose && trunk.reacts) this.ahead.stale()
    want.copy(trunk.value).multiply(LEVEL)
    head.react(want.setY(want.y + clamp(aims, -LEADS.head, LEADS.head)), delta)
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
      arm.react(want.set(clamp(SIGN[side] * swung + thrown - trunk.value.x, forth, rear), 0, 0), delta)
      // the elbow closes as the arm swings forward and opens as it swings back; under an arm that is sent somewhere, a free forearm hangs
      const bent = arm.reacts ? folded * (1 - ARMS.opens * arm.value.x) : ARMS.hangs
      forearm.react(want.set(-bent, 0, 0), delta)
      // the trunk is in an arm's way, whatever swings it: it is held off, out to its side
      while (joints.arms[side].inside(arm.value, forearm.value.x) && Math.abs(arm.value.z) < RANGE.arm.z[1])
        arm.value.z += SIGN[side] * HAIR
      hand.wrist.react(REST, delta)
      hand.fingers?.react(delta)
    }
  }

  /**
   * A hand will set off at a moment to arrive fast at another, drawn back first: he winds up for it, a free trunk like
   * a spring wound against the feet. It turns away about its length, to rest where it swings from for as long as it
   * swings down under its own weight, and back through the moment: leaning then as he would be, and square or as far as
   * the feet have the shoulder of the hand ahead, and turning as gives the hand its share of the speed, what costs the
   * trunk and the arm least between them. The pelvis turns away half as far and is square again before the trunk, and
   * his weight goes the other way. It is let go after, and turns on. Tells how hard that pushes it.
   */
  wind(side: Side, sets: number, when: number, at: Vector3, moving: Vector3) {
    const { ahead, mover } = this
    const { now } = ahead
    const swing = sway({ length: mover.size.trunk }) / 2
    // (it turns away at its ease, for three times as long as it swings: before the arm sets off, if that is sooner)
    const leaves = Math.max(now, Math.min(sets, when - 4 * swing))
    const lasts = Math.min(swing, when - leaves - tick(mover.size))
    this.unwind()
    if (!(lasts > 0) || (!this.joints.trunk.reacts && !this.swinging)) return
    // (told as he will face then)
    const round = -ahead.facing(when - now)
    const lever = at
      .clone()
      .sub(ahead.hips(when - now, hips, velocity))
      .applyAxisAngle(UP, round)
    const swung = moving.clone().applyAxisAngle(UP, round)
    // the trunk and the arm share the hand's speed as costs them least: each way the trunk turns, with the lever it has on the hand against how heavy it is to turn so, and the arm with its length
    const turning = lever.clone().cross(swung)
    for (const axis of AXES) turning[axis] /= lever.lengthSq() - lever[axis] ** 2 + WEIGHT[axis] * mover.size.arm ** 2
    // (wound no further than it turns)
    turning.y = clamp(turning.y * lasts, 2 * RANGE.trunk.y[0], 2 * RANGE.trunk.y[1]) / lasts
    // (from how it will be leaning, and coming round, when the hand sets off)
    const from = this.joints.trunk.like(ahead.trunk(leaves - now, lean))
    from.velocity.subVectors(ahead.trunk(leaves - now + NUDGE, lean), from.value).divideScalar(NUDGE)
    // to how it would be leaning then left free, whatever swing it is in now: and square, or as far as the feet have the shoulder of the hand ahead
    const to = { value: ahead.trunk(when - now, new Vector3(), true), velocity: turning }
    to.value.y = -SIGN[side] * Math.max(0, -SIGN[side] * to.value.y)
    // it turns away first, about its length, to where it swings from for as long as the arm does: leaning as it would be by then
    const [swings, back] = [when - lasts, from.like()]
    const wound = to.value.y - (turning.y * lasts) / 2
    cubic(1 - lasts / (when - leaves), when - leaves, from, to, back.value, back.velocity).setY(wound)
    back.velocity.y = 0
    from.drive(back, swings - leaves)
    back.drive(to, lasts)
    const turn = WOUND.pelvis * (wound - to.value.y)
    mover.wind = { from: leaves, swings, until: when + lasts, turn, fore: -SIGN[side], way: Math.sign(swung.z) }
    ahead.stale()
    ahead.wound = { side, leaves, swings, when, draws: from, trunk: back, to }
    return { joint: from, times: Math.max(from.takes(back, swings - leaves), back.takes(to, lasts)) }
  }

  /** a wind-up he is not to make after all: a hand's that has no fast arrival left to set off for, or whatever he was to */
  unwind(side?: Side) {
    const { ahead, mover } = this
    if (side && ahead.wound?.side !== side) return
    ahead.wound = undefined
    if (!mover.wind) return
    mover.wind = undefined
    ahead.stale()
  }

  /**
   * before the hands are aimed from where it will have their shoulders, the trunk sets off on the swing it is to make,
   * in the step of time its moment falls in, from how it is by now and not as it was looked ahead to be: a story of its
   * own, at whose end it is free again
   */
  swing() {
    const { ahead } = this
    const { trunk } = this.joints
    const { wound } = ahead
    if (!wound?.draws || !due(ahead.now + tick(this.mover.size), wound.leaves)) return
    if (!trunk.reacts && !this.swinging) return this.unwind()
    wound.draws = undefined
    this.play(this.swung((this.swinging = wound), trunk.drive(wound.trunk, wound.swings - ahead.now)))
  }

  private *swung(wound: Wound, draws: Story<boolean>): Story {
    const { trunk } = this.joints
    const drawn = yield* draws
    if (this.ahead.wound === wound) this.ahead.wound = undefined
    if (drawn && (yield* trunk.drive(wound.to, wound.when - this.ahead.now))) while (trunk.loose) yield
    if (this.swinging === wound) this.swinging = undefined
  }
}
