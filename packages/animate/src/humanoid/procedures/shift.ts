import { Vector3 } from 'three';
import type { Ctx } from '../../core/body';
import { INDEX, SIDES, type Side } from '../bones';
import type { Humanoid } from '../humanoid';
import { forwardOf, minimumJerk } from '../math';
import { STANDING_REACH } from '../start';

/** where over its foot the centre of mass stands on one leg: this far ahead of the ankle (m, default body), over the foot's middle */
const OVER_FOOT = 0.04;
/**
 * how fast the centre of mass moves shifting the weight, at its fastest (m/s, default body): a
 * deliberate shift, its extrapolated centre of mass kept over the feet
 */
const SHIFT_SPEED = 0.35;
/** how long a weight shift takes at least (s) */
const SHIFT_TIME = 0.25;
/** how far the pelvis drops as the weight goes over a foot, the knees readied for a step (× height) */
export const READY = 0.012;
/** a minimum-jerk move's peak speed over its mean */
const PEAK = 1.875;

const _over = new Vector3();

/** where the centre of mass stands over foot `side` (on the floor) */
export function overFoot<W>(h: Humanoid<W>, side: Side, out: Vector3): Vector3 {
  const f = h.status.feet[side === 'left' ? 0 : 1];
  return out
    .copy(f.position)
    .addScaledVector(forwardOf(f.yaw, _over), OVER_FOOT * h.proportions.scale)
    .setY(0);
}

/**
 * How high the pelvis stands (its root's height): as the stance has it, as low as asked or
 * `lower` (m) low, whichever is lower, and no higher than every planted foot reaches flat (the hip joints over
 * where they are)
 */
export function standingHeight<W>(ctx: Ctx<W>, h: Humanoid<W>, lower = 0): number {
  const p = h.proportions;
  const reach = STANDING_REACH * p.legLength;
  let top = p.hipHeight - h.status.stance.crouch - Math.max(h.hints.read(ctx.time).crouch, lower);
  SIDES.forEach((side, s) => {
    const f = h.status.feet[s];
    if (f.phase !== 'planted') return;
    const hip = ctx.body.positions[INDEX[`${side}UpperLeg`]];
    const across = (hip.x - f.position.x) ** 2 + (hip.z - f.position.z) ** 2;
    top = Math.min(top, f.position.y + Math.sqrt(Math.max(1e-4, reach * reach - across)) + ctx.body.positions[0].y - hip.y);
  });
  return top;
}

/**
 * Where a standing body carries its centre of mass (on the floor), and how it shifts it: over one
 * foot for a step, back over both after it, smoothly and unhurried — a minimum-jerk move, or one
 * that carries on from how the last was going when it begins before that one ended, so the centre
 * of mass never jumps nor jolts. The knees give a little as the weight goes over one foot (off
 * straight knees there is no stepping) and straighten as it comes back.
 */
export class Shift {
  /** where it carries the centre of mass now (on the floor), how fast and how it speeds up */
  readonly at = new Vector3();
  private readonly velocity = new Vector3();
  private readonly acceleration = new Vector3();
  /** the foot it goes over (null: both) */
  over: Side | null = null;
  /** how far the knees have given (0 … 1, of `READY`) */
  knees = 0;
  private readonly from = new Vector3();
  private readonly v0 = new Vector3();
  private readonly a0 = new Vector3();
  private kneesFrom = 0;
  private time = 0;
  private duration = 0;

  constructor(at: Readonly<Vector3>) {
    this.at.set(at.x, 0, at.z);
    this.from.copy(this.at);
  }

  /** begins shifting over foot `over` (null: both feet), from where and as it carries it now */
  to(over: Side | null) {
    this.over = over;
    this.from.copy(this.at);
    this.v0.copy(this.velocity);
    this.a0.copy(this.acceleration);
    this.kneesFrom = this.knees;
    this.time = 0;
    this.duration = 0;
  }

  /** carries it from `at` (on the floor) at rest, toward both feet: the body is taken over from wherever something else left it */
  restart(at: Readonly<Vector3>) {
    this.at.set(at.x, 0, at.z);
    this.velocity.set(0, 0, 0);
    this.acceleration.set(0, 0, 0);
    this.to(null);
  }

  /** whether the last shift is done */
  get shifted(): boolean {
    return this.duration > 0 && this.time >= this.duration;
  }

  /** how long the last shift has been going, over how long it takes (s) */
  get progress(): number {
    return this.duration > 0 ? this.time / this.duration : 0;
  }

  /** carries it on by `dt` toward `to` (where `over` is, on the floor; a body `scale` × the default), into `at` */
  update(to: Readonly<Vector3>, scale: number, dt: number): Vector3 {
    if (this.duration === 0) this.duration = Math.max(SHIFT_TIME, (PEAK * Math.hypot(to.x - this.from.x, to.z - this.from.z)) / (SHIFT_SPEED * scale));
    this.time += dt;
    this.knees = this.kneesFrom + ((this.over ? 1 : 0) - this.kneesFrom) * minimumJerk(this.time / this.duration);
    // (the quintic from where, how fast and how accelerating it was to `to` at rest: minimum jerk from rest)
    const T = this.duration;
    const t = Math.min(this.time, T);
    for (const k of ['x', 'z'] as const) {
      const d = to[k] - this.from[k];
      const v = this.v0[k];
      const a = this.a0[k];
      const c3 = (20 * d - 12 * v * T - 3 * a * T * T) / (2 * T ** 3);
      const c4 = (-30 * d + 16 * v * T + 3 * a * T * T) / (2 * T ** 4);
      const c5 = (12 * d - 6 * v * T - a * T * T) / (2 * T ** 5);
      this.at[k] = this.from[k] + v * t + (a / 2) * t * t + c3 * t ** 3 + c4 * t ** 4 + c5 * t ** 5;
      this.velocity[k] = v + a * t + 3 * c3 * t * t + 4 * c4 * t ** 3 + 5 * c5 * t ** 4;
      this.acceleration[k] = a + 6 * c3 * t + 12 * c4 * t * t + 20 * c5 * t ** 3;
    }
    return this.at;
  }
}
