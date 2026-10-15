import { Vector3 } from 'three';
import { action, parallel, timePassed } from '@pmndrs/timeline';
import type { Frame } from '../core/body';
import { gazeOff, lookAt, SHIFT } from '../core/gaze';
import { when } from '../core/when';
import { live, type Behaviour, type Live } from '../core/goal';
import { seeded, seedOf } from '../core/random';
import { NECK_PITCH } from './profile/limits';
import type { Humanoid } from './humanoid';
import type { ReadonlyPose } from '../core/pose';
import { clamp, forwardOf, lerp, smoothstep, wrapAngle } from '../core/math';

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
        const g = h.gait;
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
        const yaw = g.facing + HEAD_SHARE * g.thoraxYaw + glance * aside;
        return target.copy(f.prev.com(_com)).setY(height).addScaledVector(forwardOf(yaw, _v), distance);
    })();
  };
}

const _com = new Vector3();
const _v = new Vector3();

/**
 * `task` with the eyes on `at` first: `task` sets off once they are within 1° of comfortable eye range or after 1.2 s, and
 * a moment more, `lead` s (default 0.1–0.3 s, seeded by where `at` is) — the eyes reach what the
 * hand goes for ~0.5 s before it (Land & Hayhoe 2001) — and they stay till it ends. For a point
 * further below the eyes than the neck pitches the head, the body bows to see it (asks `balance`),
 * or at least `bow` (rad: work at the waist, the eyes over the hands). With `first: false` the eyes
 * do not lead: `task` sets off at once (the eyes on what the hands already work). Put it after the
 * base (its `lookAt` overrides `lookAround`'s).
 */
export function withGaze<W>(h: Humanoid<W>, at: Live<Vector3, W>, task: Behaviour<W>, options: { lead?: number; bow?: number; first?: boolean } = {}): Behaviour<W> {
  const { bow = 0, first = true } = options;
  return function* () {
    let lead = options.lead ?? NaN;
    yield* parallel<Frame<W>>(
      'race',
      function* () {
        if (first) {
          yield* when<W>((f, _, time) => {
            const point = live(at, f);
            if (Number.isNaN(lead)) lead = lerp(LEAD[0], LEAD[1], seeded(seedOf(Math.round(point.x * 1000), Math.round(point.y * 1000), Math.round(point.z * 1000)))());
            return gazeOff(h.gazer, f.prev, point) < ARRIVED || time > LONGEST;
          });
          yield* when(timePassed(lead, 'seconds'));
        }
        yield* task();
      },
      lookAt(h.gazer, at, SHIFT),
      action<Frame<W>>({ update: () => { h.asks.bow = Math.max(h.asks.bow, bow); } }),
    );
  };
}

/** Inspect a path of live attention points, continuously moving the gaze between them.
 * Segment duration is staging, not a physiological constant. Eyes and trunk share the usual limits.
 */
export function scan<W>(h: Humanoid<W>, points: readonly Live<Vector3, W>[], seconds = 0.6): Behaviour<W> {
  if (points.length < 2 || !(seconds > 0)) throw new Error('scan needs two points and a positive segment duration');
  return function* () {
    let start: number | null = null;
    yield* withGaze(h, (f) => {
      start ??= f.time;
      const along = Math.min(points.length - 1, (f.time - start) / seconds);
      const i = Math.min(points.length - 2, Math.floor(along));
      return live(points[i], f).clone().lerp(live(points[i + 1], f), smoothstep(0, 1, along - i));
    }, () => when(timePassed((points.length - 1) * seconds, 'seconds')), { first: false })();
  };
}

/** the eyes have got where they look: within this of it (rad, 1°), or looked toward it this long (s: a point the head cannot turn to); and how long after that a task they lead sets off (s) */
const ARRIVED = Math.PI / 180;
const LONGEST = 1.2;
const LEAD = [0.1, 0.3];
/** The trunk supplies downward gaze beyond comfortable cervical flexion and eye declination. */
const MOST_BOW = (90 - NECK_PITCH) * Math.PI / 180;

/** Postural requests shared by idle gaze and explicit lookAt, without writing the trunk. */
export function gazeAsks<W>(h: Humanoid<W>, pose: ReadonlyPose, point: Readonly<Vector3>) {
  const hips = pose.position(0);
  const bearing = wrapAngle(Math.atan2(point.x - hips.x, point.z - hips.z) - h.gait.facing);
  // Read profile: ~75° cervical rotation is a limit. Recruit the trunk from 63°
  // rather than waiting until the neck is already at its limit.
  if (Math.abs(bearing) > 1.1) h.asks.twist = clamp(bearing - Math.sign(bearing) * 1.1, -0.6, 0.6);
  const p = h.proportions;
  const ahead = Math.hypot(point.x - hips.x, point.z - hips.z);
  const height = point.y - hips.y;
  const neck = NECK_PITCH * Math.PI / 180;
  const trunk = p.offsets.spine.y + p.offsets.chest.y + p.offsets.neck.y;
  const head = p.offsets.head.y;
  let best = 0;
  let least = Infinity;
  // Choose a bow from standing geometry: reacting to the current head position chases its own bow.
  for (let b = 0; b <= MOST_BOW + 1e-9; b += MOST_BOW / 12) {
    const eyeUp = trunk * Math.cos(b) + head * Math.cos(b + neck / 2) + p.eyes.y * Math.cos(b + neck) - p.eyes.z * Math.sin(b + neck);
    const eyeAhead = trunk * Math.sin(b) + head * Math.sin(b + neck / 2) + p.eyes.y * Math.sin(b + neck) + p.eyes.z * Math.cos(b + neck);
    const pitch = Math.atan2(eyeUp - height, ahead - eyeAhead);
    const off = Math.max(0, pitch - (neck + h.gazer.range.down + b));
    if (off < least - 1e-3) [least, best] = [off, b];
  }
  h.asks.bow = Math.max(h.asks.bow, best);
}
