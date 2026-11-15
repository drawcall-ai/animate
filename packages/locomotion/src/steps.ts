import type { Vector3 } from 'three'
import { STILL, TOGETHER, bob, dip, runs, span, wide } from './gait'
import { type Going, clear, flat, footfall, left, over } from './footfall'
import { both, clamp, ease, type Side, SIDES, SIGN, type Size, SOLE, wrap } from '@drawcall/limbs'

/**
 * how many steps a beat he takes: standing to turn or shift at the least, at the most, and going, so many and so many
 * more for the root of every pace he goes; how far round a step turns him (rad), and in how many beats he steps round
 * to face as he is to; and how many times as fast again as he goes he steps sideways and backwards, a leg swinging
 * less far that way
 */
const RATE = { least: 0.54, most: 1.35, going: 0.18, faster: 0.54, turns: 1.1, ahead: 2, aside: 4, back: 0.6 }
/** how far ahead he steps for how fast he is going, speeding up or slowing (in his beats) */
const SOON = 0.7
/** how many times as fast the clock goes while a leg reaches its foot on the ground no longer */
const CATCH = 4
/** how much of a stride a foot is on the ground at the least running, walking, and at the most (the rest it swings) */
const DUTY = { least: 0.2, walk: 0.55, most: 0.65 }
/**
 * how high an ankle is lifted in a step, and how much higher for every pace he goes (in lengths of his leg); and
 * running, how much of the foot's way it comes through at once rather than easing off, and how much earlier than
 * halfway it is highest
 */
const LIFT = { least: 0.08, faster: 0.17, through: 0.6, early: 0.15 }

/** a foot swinging through the air: where it comes down, in the scene, and how much of the way there it has come along the ground */
type Swing = { to: Vector3; on: number }
/**
 * a foot as the steps move it: where it is in the scene, which way it points there (rad), whether it is down, whether
 * a story has it, which the steps leave be and he stands on the other meanwhile, and whether its leg reaches it from
 * where the hips are; in the air, where it is to come down and how long it has yet to swing (s)
 */
export type Placed = {
  at: Vector3
  toes: number
  down: boolean
  held: boolean
  reached: boolean
  to?: Vector3
  remains?: number
}
/** how far through a stride he is, in turns from the middle of the left foot's time on the ground, and how low and how far up and down the hips ride in it (m) */
export type Stride = { phase: number; dip: number; bob: number }

/**
 * When the feet of a body going its own way leave the ground and come down, and how they swing between. One clock
 * goes round once every two steps, as fast as his speed and his turning ask; each foot swings in its share of it, the
 * left from the turn of the clock and the right half a turn later. A foot is on the ground for as long as the hips
 * take to go past where its leg reaches: so walking slow both are down between steps, and running fast he flies. In
 * the air it swings to its footfall, aimed anew as the hips go, so turning on the spot, circling and going straight
 * are the same stepping; on the ground it stays where it is. Standing with his feet where they belong, the clock stops.
 */
export class Steps {
  /** how far round the clock is, in turns */
  phase = 0
  resting = true
  private readonly swings = both<Swing | undefined>(() => undefined)

  constructor(private readonly size: Size) {}

  clone() {
    const copy = new Steps(this.size)
    copy.phase = this.phase
    copy.resting = this.resting
    for (const side of SIDES) {
      const swing = this.swings[side]
      copy.swings[side] = swing && { to: swing.to.clone(), on: swing.on }
    }
    return copy
  }

  /** how many times as fast as he goes he steps as if he went, sideways and backwards */
  private short(going: Going) {
    const across = Math.abs(Math.sin(going.facing - going.heading))
    return 1 + RATE.aside * across + (going.speed < 0 ? RATE.back : 0)
  }

  /** how fast he will be going by the time a foot set down now has gone by, speeding up or slowing as he is (m/s) */
  private soon({ speed, faster }: Going) {
    const soon = speed + faster * SOON * this.size.beat
    return soon * speed < 0 ? 0 : soon
  }

  /** how many steps a second he takes, going as he goes and turning as he turns */
  private rate(going: Going) {
    const { beat, pace } = this.size
    const fast = (this.short(going) * Math.abs(this.soon(going))) / pace
    const turns = Math.max(Math.abs(going.spins), Math.abs(going.aims) / (RATE.ahead * beat))
    const steps = Math.max(RATE.going + RATE.faster * Math.sqrt(fast), (turns * beat) / RATE.turns)
    return clamp(steps, RATE.least, RATE.most) / beat
  }

  /** how much of a stride of so long a foot is on the ground: as long as the hips take to go past where its leg reaches, and walking, never in the air */
  private duty(going: Going, stride: number) {
    const { ahead, behind } = span(this.size, going.speed)
    const gone = this.short(going) * Math.abs(this.soon(going)) * stride
    const least = DUTY.walk + (DUTY.least - DUTY.walk) * runs(this.size, going.speed)
    return clamp((ahead + behind) / gone, least, DUTY.most)
  }

  /** how far a foot standing on the ground is from where it belongs, the hips standing as they are: the ball of the foot (m) */
  private strays(going: Going, side: Side, foot: Placed) {
    const home = going.at.clone().addScaledVector(left(going.facing), SIGN[side] * wide(this.size, 0))
    const turned = flat(foot.toes).sub(flat(going.facing + going.aims)).multiplyScalar(SOLE.ball * this.size.leg)
    return home.sub(foot.at).setY(0).add(turned).length()
  }

  /**
   * A step of time: the clock goes round, a foot whose share of it begins leaves the ground, one in the air swings on
   * to its footfall and comes down at the end of its share. Tells how far through the stride he is, for the hips to
   * rise and fall with it.
   */
  advance(going: Going, feet: Record<Side, Placed>, dt: number): Stride {
    const { size } = this
    const { leg, pace } = size
    const moving = Math.abs(going.speed) > STILL * pace || Math.abs(going.aims) > TOGETHER
    const strays = both((side) => (feet[side].down ? this.strays(going, side, feet[side]) : Infinity))
    const away = Math.max(strays.left, strays.right)
    if (this.resting) {
      if (!moving && away < TOGETHER * leg) return { phase: 0, dip: 0, bob: 0 }
      this.resting = false
      this.phase = (strays.left >= strays.right ? 0 : 0.5) - 1e-6
    }
    // (standing on both feet with the hips gone further from one than its leg reaches, as when he is set going at
    // once, the clock hurries on to its share)
    const behind = SIDES.some((side) => !feet[side].reached) && SIDES.every((side) => feet[side].down)
    const stride = 2 / (this.rate(going) * (behind ? CATCH : 1))
    const duty = this.duty(going, stride)
    const swing = 1 - duty
    // (a foot a story let go of in the air comes down from where it is, its share of the clock beginning now)
    const held = SIDES.some((side) => feet[side].held)
    for (const side of SIDES) {
      if (feet[side].held) this.swings[side] = undefined
      else if (!feet[side].down && !this.swings[side]) this.phase = start(side) + Math.floor(this.phase) - 1e-6
    }
    const was = this.phase
    this.phase += dt / stride
    for (const side of SIDES) {
      const foot = feet[side]
      if (foot.held) continue
      const through = (phase: number) => (((phase - start(side)) % 1) + 1) % 1
      const [before, now] = [through(was), through(this.phase)]
      // its share begins: it leaves the ground if it is to go anywhere and the other is not the story's
      if (now < before) this.swings[side] = undefined
      if (now < before && !held && (moving || strays[side] > (TOGETHER * leg) / 2)) {
        this.swings[side] = { to: foot.at.clone(), on: 0 }
        foot.down = false
      }
      foot.to = foot.remains = undefined
      const flying = this.swings[side]
      if (!flying) continue
      const share = Math.min(1, now / swing)
      if (share >= 1) {
        foot.at.copy(flying.to)
        foot.down = true
        this.swings[side] = undefined
        continue
      }
      const other = feet[side === 'left' ? 'right' : 'left'].at
      const lands = (swing - now) * stride
      const { to, toes } = footfall(size, going, side, lands, duty * stride, other)
      flying.to.copy(to)
      ;[foot.to, foot.remains] = [flying.to, lands]
      foot.toes += wrap(toes - foot.toes) * Math.min(1, dt / Math.max(dt, lands))
      this.swung(foot.at, flying, share, going.speed)
      // (and on its way it swings round the other leg, not through it)
      clear(size, foot.at, side, other, going.facing, going.speed, Math.sin(Math.PI * share))
    }
    if (!moving && !this.swings.left && !this.swings.right && away < TOGETHER * leg) this.resting = true
    const middle = swing + duty * over(size, going.speed)
    return { phase: this.phase - middle, dip: dip(size, going.speed), bob: bob(size, going.speed) }
  }

  /**
   * A foot swings on so far through its swing, going so fast: along the ground its share of the way left to where it
   * comes down, so that one aimed anew goes on smoothly from where it is; lifted clear on the way; and running, coming
   * through at once, the heel up behind him and the knee driving on, and slowing onto the ground.
   */
  private swung(at: Vector3, swing: Swing, share: number, speed: number) {
    const { leg, pace, ankle } = this.size
    const ran = runs(this.size, speed)
    const high = (LIFT.least + (LIFT.faster * Math.abs(speed)) / pace) * leg
    const forth = LIFT.through * ran
    const top = 0.5 - LIFT.early * ran
    const on = (1 - forth) * ease(share) + forth * (1 - (1 - share) ** 2)
    const left = swing.on < 1 ? (on - swing.on) / (1 - swing.on) : 1
    swing.on = on
    at.x += (swing.to.x - at.x) * left
    at.z += (swing.to.z - at.z) * left
    at.y = ankle + high * Math.sin(Math.PI * share ** (Math.log(0.5) / Math.log(top)))
  }
}

/** where in the turn of the clock the share of a foot begins */
const start = (side: Side) => (side === 'left' ? 0 : 0.5)
