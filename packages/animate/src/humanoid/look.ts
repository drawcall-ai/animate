import { Vector3 } from 'three';
import { action, parallel, timePassed } from '@pmndrs/timeline';
import type { Frame } from '../core/body';
import { gazeOff, lookAt, SHIFT } from '../core/gaze';
import { when } from '../core/when';
import { live, type Behaviour, type Live } from '../core/goal';
import { seeded, seedOf } from '../core/random';
import type { ReadonlyPose } from '../core/pose';
import type { Humanoid } from './humanoid';
import { forwardOf, lerp, smoothstep, wrapAngle } from '../core/math';

/** the share of the thorax's gait rotation the head goes along with (CMU mocap: ~55%) */
const HEAD_SHARE = 0.55;
/** standing, the eyes rest ahead a little below eye level; walking, on the path a few steps ahead (× height up, m ahead) */
const AHEAD = { stand: { height: 0.75, distance: 3 }, walk: { height: 0.35, distance: 4.5 } };
/** standing still, a glance aside every so often (s apart, s held, rad aside at most and up or down at most) */
const GLANCES = { every: [2.5, 5], hold: [0.8, 1.6], aside: 0.7, pitch: 0.15 };

/**
 * The eyes when nothing else asks for them: ahead (on the path, walking, the head carrying a share
 * of the thorax's swing), and, standing still for a while, a glance aside now and then (seeded: the
 * same `seed`, the same glances). Endless.
 */
export function lookAround<W>(h: Humanoid<W>, options: { seed?: number } = {}): Behaviour<W> {
  return function* () {
    const rand = seeded(options.seed ?? 1);
    const target = new Vector3();
    let next = lerp(GLANCES.every[0], GLANCES.every[1], rand());
    let until = 0;
    let aside = 0;
    let up = 0;
    const p = h.proportions;
    yield* lookAt<W>(h.gazer, (f) => {
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
export function pathAhead<W>(h: Humanoid<W>, pose: ReadonlyPose, out: Vector3): Vector3 {
  return out.copy(pose.com(_com)).setY(AHEAD.walk.height * h.proportions.height)
    .addScaledVector(forwardOf(h.locomotion.facingAhead ?? h.locomotion.facing, _v), AHEAD.walk.distance);
}

const _com = new Vector3();
const _v = new Vector3();

/**
 * `task` with the eyes on `at`. With `first: true`, `task` sets off once they are within 1° of comfortable eye range or after 1.2 s, and
 * a moment more, `lead` s (default 0.1–0.3 s, seeded by where `at` is) — the eyes reach what the
 * hand goes for ~0.5 s before it (Land & Hayhoe 2001) — and they stay till it ends. For a point
 * further below the eyes than the neck pitches the head, the body bows to see it (asks `balance`),
 * or at least `bow` (rad: work at the waist, the eyes over the hands). By default
 * `task` sets off at once (the eyes on what the hands already work). Put it after the
 * base (its `lookAt` overrides `lookAround`'s).
 */
export function withGaze<W>(h: Humanoid<W>, at: Live<Vector3, W>, task: Behaviour<W>, options: { lead?: number; bow?: number; first?: boolean } = {}): Behaviour<W> {
  const { bow = 0, first = false } = options;
  return function* () {
    yield* parallel<Frame<W>>(
      'race',
      function* () {
        if (first) yield* gazeLead(h, at, options.lead)();
        yield* task();
      },
      lookAt(h.gazer, at, SHIFT),
      action<Frame<W>>({ update: () => { h.asks.bow = Math.max(h.asks.bow, bow); } }),
    );
  };
}

/** Wait for the current gaze before starting a task; does not own or move the eyes. */
export function gazeLead<W>(h: Humanoid<W>, at: Live<Vector3, W>, seconds = NaN): Behaviour<W> {
  return function* () {
    let lead = seconds;
    yield* when<W>((f, _, time) => {
      const point = live(at, f);
      if (Number.isNaN(lead)) lead = lerp(LEAD[0], LEAD[1], seeded(seedOf(Math.round(point.x * 1000), Math.round(point.y * 1000), Math.round(point.z * 1000)))());
      return gazeOff(h.gazer, f.prev, point) < ARRIVED || time > LONGEST;
    });
    yield* when(timePassed(lead, 'seconds'));
  };
}

/** the eyes have got where they look: within this of it (rad, 1°), or looked toward it this long (s: a point the head cannot turn to); and how long after that a task they lead sets off (s) */
const ARRIVED = Math.PI / 180;
const LONGEST = 1.2;
const LEAD = [0.1, 0.3];

/** Upper-body aim, with the gait's counter-rotation and balance preserved.
 * Recalled: Epic Games, Unreal Engine “Aim Offset”: additive aim over the spine and neck.
 * Tuned torso shares: 65% yaw, 25% pitch; balance shares them over spine/chest,
 * gaze handles neck/head/eyes. Pitch recruits less trunk so looking down does not become a bow.
 * The existing posture and gaze owners retain their motion limits and final-pose checks.
 */
export function aimAt<W>(h: Humanoid<W>, at: Live<Vector3, W>): Behaviour<W> {
  return function* () {
    yield* parallel<Frame<W>>('all', lookAt(h.gazer, at, SHIFT), action<Frame<W>>({ update: (f) => {
      const direction = live(at, f).clone().sub(h.gazer.eyes(f.prev, new Vector3()));
      const yaw = wrapAngle(Math.atan2(direction.x, direction.z) - h.locomotion.facing);
      const pitch = -Math.atan2(direction.y, Math.hypot(direction.x, direction.z));
      // Derived: two 25° axial joint ranges, leaving 5° for gait counter-rotation.
      h.asks.twist = Math.max(-Math.PI / 4, Math.min(Math.PI / 4, 0.65 * yaw));
      h.asks.bow = 0.25 * pitch;
    } }));
  };
}
