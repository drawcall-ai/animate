import type { Quaternion } from 'three';
import type { Box, Sphere } from '../input';
import type { Proportions } from '../proportions';
import type { Stance } from '../stance';
import { createTrunkFrame, type TrunkFrame } from '../pose/frames';
import { P, obstacleDepth, trunkFK, type Overlay } from './trunk';

/** the posture parameters nudged out of body obstacles */
export const GIVE_WAY: readonly number[] = [P.HIP, P.SPINE, P.SHIFT, P.SIDE, P.ROLL, P.DROP];

/** What a posture gives way to, and the scratch it works in. */
export interface Giving {
  readonly d: Proportions;
  readonly stance: Stance;
  readonly overlay: Overlay;
  /** the volumes the trunk and head stay out of, and the head rotation they're judged with */
  readonly tasks: { readonly bodyObstacles: readonly (Sphere | Box)[]; readonly headRot: Quaternion | null };
  readonly frame: TrunkFrame;
  /** scratch: the depth's gradient over GIVE_WAY */
  readonly grad: Float64Array;
}

export const createGiving = (d: Proportions, stance: Stance, overlay: Overlay, tasks: Giving['tasks']): Giving => ({
  d,
  stance,
  overlay,
  tasks,
  frame: createTrunkFrame(),
  grad: new Float64Array(GIVE_WAY.length),
});

/**
 * A human-paced posture `p` may lag into a body obstacle: push the trunk/head out by
 * nudging lean, pelvis shift, side bend and squat depth (a few Gauss–Newton steps on the
 * penetration depth), so the body visibly gives way instead of passing through. Returns
 * whether there was anything to give way to.
 */
export function giveWay(p: Float64Array, g: Giving, legLift: number): boolean {
  if (!g.tasks.bodyObstacles.length) return false;
  const { grad } = g;
  for (let it = 0; it < 4; it++) {
    const e = depth(p, g, legLift);
    if (e <= 0.002) break;
    let g2 = 0;
    for (let i = 0; i < GIVE_WAY.length; i++) {
      const k = GIVE_WAY[i];
      const saved = p[k];
      p[k] = saved + 1e-3;
      const g1 = depth(p, g, legLift);
      p[k] = saved;
      grad[i] = (g1 - e) / 1e-3;
      g2 += grad[i] * grad[i];
    }
    if (g2 < 1e-9) break;
    for (let i = 0; i < GIVE_WAY.length; i++) p[GIVE_WAY[i]] -= (e * grad[i]) / g2;
  }
  return true;
}

/** how deep posture `p` reaches into the body obstacles (the deepest) */
function depth(p: Float64Array, g: Giving, legLift: number): number {
  const { d, frame, tasks } = g;
  trunkFK(p, d, g.stance, frame, g.overlay, tasks.headRot, legLift);
  let worst = 0;
  for (const a of tasks.bodyObstacles) worst = Math.max(worst, obstacleDepth(a, frame, d));
  return worst;
}
