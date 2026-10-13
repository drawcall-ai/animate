// Adapted from @prohuman/core (packages/core/src/gait/roll.ts: FootRoll.plantedPitch).
import type { Ctx } from '@prohuman/body';
import { lerp, smoothstep } from '../math';
import { shankTilt } from '../procedures/step';
import { Vector3 } from 'three';
import { STANDING_REACH } from '../start';
import { ankleFor } from './foot';
import type { Gait } from './gait';

/** time over which the foot rolls flat about the heel after heel strike (s) */
const HEEL_ROCKER = 0.12;
/**
 * How far the ankle dorsiflexes (the shank tilting forward over the foot, rad) before the heel
 * comes up: standing, the range's end (~35°); walking, the calf holds it at ~11° and the heel
 * rises from mid-stance on; running at ~26° (Perry 1992; CMU mocap).
 */
const HEEL_OFF = { stand: 0.62, walk: 0.19, run: 0.45 };
/** push-off: how much further the ankle plantarflexes by toe-off (rad): to ~15° past neutral walking, ~25° running */
const PUSH = { walk: 0.46, run: 0.88 };
/** how far a planted leg reaches, at most (× its length): a little short of straight */
export const REACH = 0.975;
/** the most a planted heel rises (rad) */
export const MAX_HEEL = 1.05;

/**
 * How a planted foot `s` of a walk is rolled (+ toes up, − heel up): landed on the heel, it rolls
 * flat; its heel rises once the shank tilts past what the ankle allows, more as it pushes off
 * (walking through the double support, running through the stance's second half); up onto the
 * ball whenever the leg could not otherwise reach.
 */
const _hip = new Vector3();

export function plantedPitch<W>(ctx: Ctx<W>, g: Gait, s: number): number {
  const f = g.feet[s];
  const foot = g.status[s];
  if (f.plantedTime < HEEL_ROCKER && f.landPitch !== 0) return f.landPitch * (1 - smoothstep(0, HEEL_ROCKER, f.plantedTime));
  const t = g.timing();
  const other = g.feet[1 - s];
  const trailing = !other.swinging && other.plantedTime < f.plantedTime;
  const walkPush = trailing ? smoothstep(0, t.doubleSupport, other.plantedTime) * (1 - smoothstep(0.25, 0.45, other.plantedTime)) : 0;
  const runPush = smoothstep(0.45, 1, f.plantedTime / t.stance);
  const limit = lerp(lerp(HEEL_OFF.stand, HEEL_OFF.walk, g.walk), HEEL_OFF.run, t.run);
  const ankle = limit - lerp(PUSH.walk * walkPush, PUSH.run * runPush, t.run) * g.walk;
  let pitch = Math.max(-MAX_HEEL, Math.min(0, ankle - shankTilt(ctx, f.side, foot.yaw)));
  const hip = g.hip(f.side, _hip);
  // (standing, as far as the stand stands; walking, a little short of straight)
  const reach = lerp(STANDING_REACH, REACH, g.bent) * g.p.legLength;
  if (hip.distanceTo(ankleFor(g.p, f.side, foot.position, foot.yaw, pitch)) <= reach) return pitch;
  let lo = -MAX_HEEL;
  let hi = pitch;
  for (let i = 0; i < 14; i++) {
    const mid = (lo + hi) / 2;
    if (hip.distanceTo(ankleFor(g.p, f.side, foot.position, foot.yaw, mid)) > reach) hi = mid;
    else lo = mid;
  }
  return lo;
}
