import { Vector3 } from 'three';
import { lookAt } from '../core/gaze';
import type { Behaviour } from '../core/goal';
import { seeded } from '../core/random';
import type { ReadonlyPose } from '../core/pose';
import type { Humanoid } from './humanoid';
import { forwardOf, lerp, smoothstep } from '../core/math';

/** the share of the thorax's gait rotation the head goes along with (CMU mocap: ~55%) */
const HEAD_SHARE = 0.55;
/** standing, the eyes rest ahead a little below eye level; walking, on the path a few steps ahead (× height up, m ahead) */
const AHEAD = { stand: { height: 0.75, distance: 3 }, walk: { height: 0.35, distance: 4.5 } };
/** standing still, a glance aside every so often (s apart, s held, rad aside at most and up or down at most) */
const GLANCES = { every: [2.5, 5], hold: [0.8, 1.6], aside: 0.7, pitch: 0.15 };

/** How `lookAround` glances. */
export interface LookAroundOptions {
  /** the same seed, the same glances */
  seed?: number;
}

/**
 * The eyes when nothing else asks for them: ahead (on the path, walking, the head carrying a share
 * of the thorax's swing), and, standing still for a while, a glance aside now and then (seeded: the
 * same `seed`, the same glances). Endless.
 */
export function lookAround(h: Humanoid, options: LookAroundOptions = {}): Behaviour {
  return function* () {
    const rand = seeded(options.seed ?? 1);
    const target = new Vector3();
    let next = lerp(GLANCES.every[0], GLANCES.every[1], rand());
    let until = 0;
    let aside = 0;
    let up = 0;
    const p = h.proportions;
    yield* lookAt(h, (f) => {
        const g = h.locomotion;
        // (glances only standing still: walking, the eyes are on the way)
        if (g.walk > 0.05) {
          next = Math.max(next, f.time + GLANCES.every[0]);
          until = 0;
        }
        if (f.time >= next) {
          until = f.time + lerp(GLANCES.hold[0], GLANCES.hold[1], rand());
          next = until + lerp(GLANCES.every[0], GLANCES.every[1], rand());
          aside = (2 * rand() - 1) * GLANCES.aside;
          up = (2 * rand() - 1) * GLANCES.pitch;
        }
        const glance = f.time < until ? 1 : 0;
        const w = smoothstep(0.1, 0.6, g.walk);
        const distance = lerp(AHEAD.stand.distance, AHEAD.walk.distance, w);
        const height = lerp(AHEAD.stand.height, AHEAD.walk.height, w) * p.height + glance * up * distance;
        const yaw = (g.facingAhead ?? g.facing) + HEAD_SHARE * g.thoraxYaw + glance * aside;
        return target.copy(f.prev.com(_com)).setY(height).addScaledVector(forwardOf(yaw, _v), distance);
    })();
  };
}

/** The walking gaze's path point, shared by a long approach and the idle gaze. */
export function pathAhead(h: Humanoid, pose: ReadonlyPose, out: Vector3): Vector3 {
  return out.copy(pose.com(_com)).setY(AHEAD.walk.height * h.proportions.height)
    .addScaledVector(forwardOf(h.locomotion.facingAhead ?? h.locomotion.facing, _v), AHEAD.walk.distance);
}

const _com = new Vector3();
const _v = new Vector3();

