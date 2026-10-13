import { Vector3 } from 'three';
import { action, type NonReuseableTimeline } from '@pmndrs/timeline';
import type { Ctx } from '@prohuman/body';
import { INDEX, SIDES, type Side } from '../bones';
import type { Humanoid } from '../humanoid';
import { forwardOf, minimumJerk } from '../math';
import { STANDING_REACH } from '../start';

/** how firmly the centre of mass is carried over the standing foot (Hz) */
export const SHIFT_STIFFNESS = 20;
/** where over its foot the centre of mass stands on one leg: this far ahead of the ankle (m, default body), over the foot's middle */
const OVER_FOOT = 0.04;
/**
 * how fast the centre of mass moves shifting the weight, at its fastest (m/s, default body): a
 * deliberate shift, its extrapolated centre of mass kept over the feet
 */
const SHIFT_SPEED = 0.35;
/** how long a weight shift takes at least (s) */
const SHIFT_TIME = 0.25;
/** how far the pelvis drops as the weight shifts, the knees readied for a step (× height) */
export const READY = 0.012;
/** how near over the foot the centre of mass is when the weight is on it (m, default body) */
const THERE = 0.02;
/** a minimum-jerk move's peak speed over its mean */
const PEAK = 1.875;

const _over = new Vector3();
const _com = new Vector3();

/** where the centre of mass stands over foot `side` (on the floor) */
export function overFoot<W>(h: Humanoid<W>, side: Side, out: Vector3): Vector3 {
  const f = h.status.feet[side === 'left' ? 0 : 1];
  return out
    .copy(f.position)
    .addScaledVector(forwardOf(f.yaw, _over), OVER_FOOT * h.proportions.scale)
    .setY(0);
}

/**
 * How high the pelvis stands (its root's height): as the stance has it, as low as asked, and no
 * higher than every planted foot reaches flat (the hip joints over where they are)
 */
export function standingHeight<W>(ctx: Ctx<W>, h: Humanoid<W>): number {
  const p = h.proportions;
  const reach = STANDING_REACH * p.legLength;
  let top = p.hipHeight - h.status.stance.crouch - h.hints.read(ctx.time).crouch;
  SIDES.forEach((side, s) => {
    const f = h.status.feet[s];
    if (f.phase !== 'planted') return;
    const hip = ctx.body.positions[INDEX[`${side}UpperLeg`]];
    const across = (hip.x - f.position.x) ** 2 + (hip.z - f.position.z) ** 2;
    top = Math.min(top, f.position.y + Math.sqrt(Math.max(1e-4, reach * reach - across)) + ctx.body.positions[0].y - hip.y);
  });
  return top;
}

/** proposes the centre of mass carried at `at` on the floor, the pelvis standing as high as `standingHeight` */
export function carryCom<W>(ctx: Ctx<W>, h: Humanoid<W>, at: Vector3, owner: string) {
  const y = ctx.body.com.y + standingHeight(ctx, h) - ctx.body.positions[0].y;
  ctx.propose.target({ kind: 'position', point: 'com', value: _com.set(at.x, y, at.z), weight: 1, stiffness: SHIFT_STIFFNESS, owner });
}

/**
 * Shifting the weight onto foot `side`: the centre of mass carried from where it is over that
 * foot, smoothly (minimum jerk) and unhurried, while `hold` keeps the feet as they are.
 */
export function shiftWeight<W>(h: Humanoid<W>, side: Side, owner: string, hold: (ctx: Ctx<W>) => void): NonReuseableTimeline<Ctx<W>, void> {
  return (function* () {
    const from = new Vector3();
    const to = new Vector3();
    const at = new Vector3();
    let started = false;
    let duration = SHIFT_TIME;
    yield* action<Ctx<W>>({
      update: (ctx, _, time) => {
        if (!started) {
          started = true;
          from.copy(ctx.body.com).setY(0);
          duration = Math.max(SHIFT_TIME, (PEAK * from.distanceTo(overFoot(h, side, to))) / (SHIFT_SPEED * h.proportions.scale));
        }
        hold(ctx);
        overFoot(h, side, to);
        const k = minimumJerk((time + ctx.dt) / duration);
        // (the knees giving a little as the weight goes over: off straight knees there is no stepping)
        h.hints.crouch(ctx.time, READY * h.proportions.height * k);
        carryCom(ctx, h, at.lerpVectors(from, to, k), owner);
      },
      // (done once the centre of mass is there, or as near as it gets in twice the time)
      until: (ctx, __, time) => time >= duration && (_com.set(ctx.body.com.x, 0, ctx.body.com.z).distanceTo(to) < THERE * h.proportions.scale || time >= 2 * duration),
    });
  })();
}
