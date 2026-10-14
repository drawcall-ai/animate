import { Vector3 } from 'three';
import { action, parallel, timePassed } from '@pmndrs/timeline';
import type { Frame } from '../core/body';
import { lookAt, SHIFT } from '../core/gaze';
import { live, type Behaviour, type Live } from '../core/goal';
import type { Humanoid } from './humanoid';
import { forwardOf, lerp, smoothstep } from './math';

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
    const rand = mulberry32(options.seed ?? 1);
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

/** a seeded uniform [0, 1) (mulberry32) */
function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const _com = new Vector3();
const _v = new Vector3();

/**
 * `task` with the eyes on `at` first: they go there `lead` s before it sets off (people fixate what
 * they reach for ~0.5–1 s before the hand gets there: Land & Hayhoe 2001) and stay till it ends.
 * For a point further below the eyes than the neck pitches the head, the body bows to see it (asks
 * `balance`), or at least `bow` (rad: work at the waist, the eyes over the hands). Put it after the
 * base (its `lookAt` overrides `lookAround`'s).
 */
export function withGaze<W>(h: Humanoid<W>, at: Live<Vector3, W>, task: Behaviour<W>, options: { lead?: number; bow?: number } = {}): Behaviour<W> {
  const { lead = 0.5, bow = 0 } = options;
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
    yield* parallel<Frame<W>>(
      'race',
      function* () {
        yield* action({ until: timePassed(lead, 'seconds') });
        yield* task();
      },
      lookAt(h.gazer, at, SHIFT),
      action<Frame<W>>({ update: bowing }),
    );
  };
}

/** looking down: how far the head pitches on the neck (rad, ~57°: the neck's flexion short of its end), and how far the body bows to see lower at most (rad) */
const NECK_PITCH = 1.0;
const MOST_BOW = 0.35;
/** how far ahead of the hips the eyes are standing (m, default body) */
const EYES_AHEAD = 0.09;
const _eyes = new Vector3();
const _to = new Vector3();
