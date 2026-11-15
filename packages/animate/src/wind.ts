import { Vector3 } from 'three'
import type { Ahead } from './ahead'
import { AXES, type State, cubic } from './curve'
import type { Goal } from './goal'
import { type Joints, RANGE } from './joints'
import { sway } from './limb'
import type { Mover } from './mover'
import { SIGN, type Side, tick } from './size'
import { NUDGE, type Story, UP, clamp, due } from './world'

/**
 * winding up for an end that is to arrive fast: how much of the way from between his feet to the foot behind his
 * weight goes, and as it swings through, to the one ahead; and how much of the trunk's turn away the pelvis does
 */
const WOUND = { weight: 0.5, pelvis: 0.5 }
/** how many times heavier than an arm is to swing the trunk is to lean, to turn about its length, as lightly as an arm swings, and to tilt */
const WEIGHT = new Vector3(12, 1, 12)
const hips = new Vector3()
const lean = new Vector3()
const velocity = new Vector3()

/**
 * what the hips do for an end that is to arrive fast: from a moment he is drawn back, the pelvis turned so far (rad)
 * and his weight on the foot behind along a `way`, from another he swings through, the other way, until a last; and
 * which way the hip of that end is `fore`, about the vertical
 */
export type Wind = { from: number; swings: number; until: number; turn: number; fore: number; way: number }
/**
 * the swing a free trunk is to make into a fast hand: from the moment the hand sets off, as the trunk will be leaning
 * then, it `draws` back, until it does, to where it `swings` from, to how it is to be leaning and turning when the
 * hand arrives
 */
type Wound = { side: Side; leaves: number; swings: number; when: number; draws?: Goal; trunk: Goal; to: State }

/** how he is wound up at a moment, on the ground: 1 drawn back, -1 swinging through, 0 with nothing to wind up for or a jump to make */
export const wound = (wind: Wind | undefined, time: number, jumps: boolean) =>
  !wind || jumps || time < wind.from || time >= wind.until ? 0 : time < wind.swings ? 1 : -1

/**
 * how far the pelvis turns that the feet would turn so far, wound up: the hip of the hand is no further behind than
 * square, it turns away while he is drawn back, and is square again ahead of the trunk, which swings for longer than
 * the pelvis comes round
 */
export const pelvis = (wind: Wind | undefined, wound: number, feet: number) =>
  wind && wound ? wind.fore * Math.max(0, wind.fore * feet) + (wound > 0 ? wind.turn : 0) : feet

/**
 * how much nearer than where he is to come to rest between his feet his weight is, wound up: onto the foot behind, and
 * onto the one ahead as he swings through; or none, wound up or not, where that is not between the feet, the `rear`
 * and the `front`
 */
export function weight(wind: Wind | undefined, wound: number, halt: number | undefined, rear: number, front: number) {
  const shifts = wound !== 0 && halt !== undefined && halt >= rear && halt <= front
  const load = (wind?.way ?? 0) * wound * WOUND.weight
  return shifts ? halt - (rear + front + load * (rear - front)) / 2 : undefined
}

/**
 * The wind-up for a hand that is to arrive fast: the trunk turns away and swings through, the pelvis with it and his
 * weight the other way, as the hips' `wind` has them. What it has of the trunk is how it will be turned meanwhile.
 */
export class Winder {
  /** the swing the trunk is to make, as it is looked ahead to, and the swing it is making: the body's own, which a later one takes over */
  private wound?: Wound
  private swinging?: Wound

  constructor(
    private readonly ahead: Ahead,
    private readonly mover: Mover,
    private readonly joints: Joints,
  ) {}

  /**
   * A hand will set off at a moment to arrive fast at another, drawn back first: he winds up for it, a free trunk like
   * a spring wound against the feet. It turns away about its length, to rest where it swings from for as long as it
   * swings down under its own weight, and back through the moment: leaning then as he would be, and square or as far as
   * the feet have the shoulder of the hand ahead, and turning as gives the hand its share of the speed, what costs the
   * trunk and the arm least between them. The pelvis turns away half as far and is square again before the trunk, and
   * his weight goes the other way. It is let go after, and turns on. Tells how hard that pushes it.
   */
  up(side: Side, sets: number, when: number, at: Vector3, moving: Vector3) {
    const { ahead, mover } = this
    const { now } = ahead
    const swing = sway({ length: mover.size.trunk }) / 2
    // (it turns away at its ease, for three times as long as it swings: before the arm sets off, if that is sooner)
    const leaves = Math.max(now, Math.min(sets, when - 4 * swing))
    const lasts = Math.min(swing, when - leaves - tick(mover.size))
    this.off()
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
    this.wound = { side, leaves, swings, when, draws: from, trunk: back, to }
    return { joint: from, times: Math.max(from.takes(back, swings - leaves), back.takes(to, lasts)) }
  }

  /** a wind-up he is not to make after all: a hand's that has no fast arrival left to set off for, or whatever he was to */
  off(side?: Side) {
    const { ahead, mover } = this
    if (side && this.wound?.side !== side) return
    this.wound = undefined
    if (!mover.wind) return
    mover.wind = undefined
    ahead.stale()
  }

  /** how the trunk will be turned at a moment, if it is to be swinging into a fast hand then */
  trunk(then: number, to: Vector3) {
    const { wound } = this
    if (wound && then >= wound.swings) return wound.trunk.ahead(then - wound.swings, to, velocity)
    if (wound?.draws && then >= wound.leaves) return wound.draws.ahead(then - wound.leaves, to, velocity)
    return undefined
  }

  /**
   * before the hands are aimed from where it will have their shoulders, the trunk sets off on the swing it is to make,
   * in the step of time its moment falls in, from how it is by now and not as it was looked ahead to be: a story of its
   * own to play, at whose end it is free again
   */
  start() {
    const { ahead, wound } = this
    const { trunk } = this.joints
    if (!wound?.draws || !due(ahead.now + tick(this.mover.size), wound.leaves)) return undefined
    if (!trunk.reacts && !this.swinging) return this.off()
    wound.draws = undefined
    return this.swung((this.swinging = wound), trunk.drive(wound.trunk, wound.swings - ahead.now))
  }

  private *swung(wound: Wound, draws: Story<boolean>): Story {
    const { trunk } = this.joints
    const drawn = yield* draws
    if (this.wound === wound) this.wound = undefined
    if (drawn && (yield* trunk.drive(wound.to, wound.when - this.ahead.now))) while (trunk.loose) yield
    if (this.swinging === wound) this.swinging = undefined
  }
}
