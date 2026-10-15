import { Vector3 } from 'three';
import { action, parallel, timePassed } from '@pmndrs/timeline';
import type { Frame } from '../core/body';
import { gazeOff, lookAt, SHIFT } from '../core/gaze';
import { when } from '../core/when';
import { live, type Behaviour, type Live } from '../core/goal';
import { seeded, seedOf } from '../core/random';
import type { Humanoid } from './humanoid';
import { forwardOf, lerp, smoothstep } from '../core/math';

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
        if (g.walk > 0.05) next = Math.max(next, f.time + GLANCES.every[0]);
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
 * `task` with the eyes on `at` first: `task` sets off once they have got there (within ARRIVED) and
 * a moment more, `lead` s (default 0.1–0.3 s, seeded by where `at` is) — the eyes reach what the
 * hand goes for ~0.5 s before it (Land & Hayhoe 2001) — and they stay till it ends. For a point
 * further below the eyes than the neck pitches the head, the body bows to see it (asks `balance`),
 * or at least `bow` (rad: work at the waist, the eyes over the hands). With `first: false` the eyes
 * do not lead: `task` sets off at once (the eyes on what the hands already work). Put it after the
 * base (its `lookAt` overrides `lookAround`'s).
 */
export function withGaze<W>(h: Humanoid<W>, at: Live<Vector3, W>, task: Behaviour<W>, options: { lead?: number; bow?: number; first?: boolean } = {}): Behaviour<W> {
  const { bow = 0, first = true } = options;
  const bowing = (f: Frame<W>) => {
    // (as the hips stand: how far ahead of them and below the eyes the point is; then the bow under
    // which the head, pitched as far as the neck takes it on top of the bow, comes nearest to it —
    // bowing too far puts the eyes past a point close to the body)
    const p = h.proportions;
    const hips = f.prev.position(0);
    const ahead = _to.subVectors(live(at, f), hips).dot(forwardOf(h.gait.facing, _eyes));
    const height = live(at, f).y - hips.y;
    const above = p.eyeHeight - p.hipHeight;
    let best = 0;
    let least = Infinity;
    for (let b = 0; b <= MOST_BOW + 1e-9; b += MOST_BOW / 7) {
      const pitch = Math.atan2(above * Math.cos(b) - height, ahead - EYES_AHEAD * p.scale - above * Math.sin(b));
      const off = Math.abs(pitch - Math.min(pitch, NECK_PITCH + b));
      if (off < least - 1e-3) [least, best] = [off, b];
    }
    h.asks.bow = Math.max(h.asks.bow, bow, best);
  };
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
      action<Frame<W>>({ update: bowing }),
    );
  };
}

/** the eyes have got where they look: within this of it (rad, 10°), or looked toward it this long (s: a point the head cannot turn to); and how long after that a task they lead sets off (s) */
const ARRIVED = (10 * Math.PI) / 180;
const LONGEST = 1.2;
const LEAD = [0.1, 0.3];
/** looking down: how far the head pitches on the neck (rad, ~57°: the neck's flexion short of its end), and how far the body bows to see lower at most (rad) */
const NECK_PITCH = 1.0;
const MOST_BOW = 0.35;
/** how far ahead of the hips the eyes are standing (m, default body) */
const EYES_AHEAD = 0.09;
const _eyes = new Vector3();
const _to = new Vector3();
