import { Vector3 } from 'three';
import { steppable } from '../../gait/obstacles';
import { isSphere, type Box } from '../../input';
import type { PostureCost } from '../cost';
import { P, obstacleDepth } from '../trunk';

/** how far the body's front lies ahead of its centre (× height) */
const BODY_FRONT = 0.12;
const _root = new Vector3();

/**
 * Where to stand and what to keep clear of: floor obstacles under the feet (4 per
 * obstacle that blocks standing, planner), the requested standing spot (2, + 1 with a
 * facing, planner), body obstacles (1 per sphere), staying close to the current state
 * (3 for the planner, 1 for the posture).
 */
export function footingRows(c: PostureCost, p: Float64Array, r: Float64Array, n: number): number {
  const { d, tasks: t, frame, home, planner, walk, root } = c;

  // ---- (planner) stay clear of obstacles: toes and heels outside, with a little margin
  const fwd = c.supportForward;
  if (planner) for (const o of t.floorObstacles) {
    // low obstacles are walked over (the gait clears them); they only block standing
    if (steppable(o, d) && (walk > 0.3 || o === c.crossing)) continue;
    for (let s = 0; s < 2; s++) {
      r[n++] = 12 * penetration(o, home[s], fwd, d.toeFront + 0.14);
      r[n++] = 12 * penetration(o, home[s], fwd, -d.heelBack - 0.08);
    }
    // (leaning into a force at the hands, the body stands ahead of its feet: it stays out too, its front a trunk's depth on)
    if (c.strain > 0) r[n++] = 12 * penetration(o, _root.set(p[P.X], 0, p[P.Z]), fwd, BODY_FRONT * d.height);
  }

  const goal = planner ? t.goal : null;
  if (goal) {
    r[n++] = 12 * goal.weight * (p[P.X] - goal.pos.x);
    r[n++] = 12 * goal.weight * (p[P.Z] - goal.pos.z);
    if (goal.yaw !== null) r[n++] = 6 * goal.weight * c.yawError(p[P.YAW], goal.yaw);
  }

  // ---- self-collision proxies: trunk and head stay clear of body obstacles
  // (where to stand ignores boxes overhead: the body ducks under them where it goes)
  for (const a of t.approaching) if (!planner || isSphere(a)) r[n++] = 60 * Math.max(0, obstacleDepth(a, frame, d));

  // ---- regularise toward the current state
  const yawErr = c.yawError(p[P.YAW], root.yaw + (planner ? 0 : c.yawLead));
  if (planner) {
    r[n++] = 0.9 * (p[P.X] - root.x);
    r[n++] = 0.9 * (p[P.Z] - root.z);
  }
  r[n++] = (planner ? 0.35 : 2.5) * yawErr;
  return n;
}

/** how deep the point `reach` along `fwd` from the ankle lies inside the obstacle (0 outside) */
function penetration(o: Box, ankle: Vector3, fwd: Vector3, reach: number): number {
  const x = ankle.x + fwd.x * reach;
  const z = ankle.z + fwd.z * reach;
  return Math.max(0, Math.min(x - o.min.x, o.max.x - x, z - o.min.z, o.max.z - z));
}
