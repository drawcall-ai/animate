import { Quaternion, Vector3 } from 'three';
import type { Frame } from '../core/body';
import type { Item } from '../core/carrier';
import { live, type Live, type Placement } from '../core/goal';
import { exp, log } from '../core/rotation';
import { minimumJerk } from '../core/math';

/** A leg's duration (s) and place in the course's frame, read every sub-step.
 * A goal may also read the fixed course start and the preceding place in that frame.
 * `still` pauses at the preceding place.
 */
export type Leg<W = unknown> = [seconds: number, to: Placement | ((f: Frame<W>, start: Required<Placement>, last: Required<Placement>) => Placement)];

/** A course an item is carried along: where it is at a sub-step (`to`), and whether it has gone all its way (`over`). */
export interface Course<W = unknown> {
  to: (f: Frame<W>) => Required<Placement>;
  over: (f: Frame<W>) => boolean;
}

/**
 * A course through `frame` (a moving frame: a placement with no scale of its own) from where `item`
 * is when it is first read, through its legs' placements (distances × `scale`) as one smooth curve
 * (centripetal Catmull–Rom, the rotation turned along it), timed by one minimum-jerk profile over
 * its whole length that takes as long as its legs together, `pace` times as fast as they say: it
 * passes its placements on the way without stopping and comes to rest only at the end — and where
 * a leg holds still (`still`) or the way turns back on itself (by more than 135°: the hand
 * stops to reverse), it comes to rest there and sets off again.
 * It sets off `delay` s after it is first read.
 */
export function course<W>(item: Item, frame: Live<Required<Placement>, W>, legs: readonly Leg<W>[], { scale = 1, pace = 1, delay = 0 } = {}): Course<W> {
  let start = NaN;
  let runs: Run[] = [];
  let from: Required<Placement> | undefined;
  const moving = legs.some(([, to]) => typeof to === 'function');
  const total = legs.reduce((sum, [seconds]) => sum + seconds / pace, 0);
  const to = (f: Frame<W>): Required<Placement> => {
    const at = live(frame, f);
    if (from === undefined) {
      start = f.time;
      const inverse = at.quaternion.clone().invert();
      // (where it sets out from, in the frame unscaled: the legs' placements are scaled)
      from = { position: item.current.position.clone().sub(at.position).applyQuaternion(inverse).divideScalar(scale), quaternion: inverse.multiply(item.current.quaternion) };
    }
    if (!runs.length || moving) {
      const stops: Required<Placement>[] = [from];
      for (const [, leg] of legs) {
        const last = stops[stops.length - 1];
        const next = typeof leg === 'function' ? leg(f, from, last) : leg;
        stops.push({ position: next.position.clone(), quaternion: (next.quaternion ?? last.quaternion).clone() });
      }
      runs = runsOf(stops, legs.map(([seconds]) => seconds / pace));
    }
    let t = Math.max(0, f.time - start - delay);
    let i = 0;
    while (i < runs.length - 1 && t > runs[i].seconds) t -= runs[i++].seconds;
    const { position, quaternion } = runs[i].at(minimumJerk(t / runs[i].seconds), _at);
    return {
      position: position.multiplyScalar(scale).applyQuaternion(at.quaternion).add(at.position).clone(),
      quaternion: at.quaternion.clone().multiply(quaternion),
    };
  };
  return { to, over: (f) => !Number.isNaN(start) && f.time - start >= delay + total };
}

/** a leg that stays where the one before ended: a moment held still */
export const still = (_f: Frame, _start: Required<Placement>, last: Placement) => last;

/** a stretch of a course gone without stopping: how long it takes (s), and where it is a share `s` of its length along */
interface Run {
  seconds: number;
  at: (s: number, out: Required<Placement>) => Required<Placement>;
}

/** how far a turn counts as going along a course (m per rad): a hand turning what it holds about its grip moves its far side about so much */
const TURN = 0.1;
/** how sharply the way may bend at a placement and still be passed without stopping (rad): a hand sweeps round a bend, but stops to go back the way it came */
const REVERSE = (3 * Math.PI) / 4;

/** the course through `stops`, each leg taking `seconds`, cut into runs where it holds still or turns back on itself */
function runsOf(stops: readonly Required<Placement>[], seconds: readonly number[]): Run[] {
  const runs: Run[] = [];
  let first = 0;
  let time = 0;
  for (let i = 0; i < seconds.length; i++) {
    time += seconds[i];
    const end = i === seconds.length - 1;
    const held = lengthOf(stops[i], stops[i + 1]) < 1e-6;
    const next = !end && lengthOf(stops[i + 1], stops[i + 2]) < 1e-6;
    const back = !end && !next && !held && bend(stops[i], stops[i + 1], stops[i + 2]) > REVERSE;
    if (held) {
      runs.push(stay(stops[i], time));
      first = i + 1;
      time = 0;
    } else if (end || next || back) {
      runs.push(curve(stops.slice(first, i + 2), time));
      first = i + 1;
      time = 0;
    }
  }
  return runs;
}

/** a run staying at `at` for `seconds` */
function stay(at: Required<Placement>, seconds: number): Run {
  return { seconds, at: (_, out) => (out.position.copy(at.position), out.quaternion.copy(at.quaternion), out) };
}

/** how long a leg from `a` to `b` is (m): its way and its turn (`TURN`) */
function lengthOf(a: Required<Placement>, b: Required<Placement>): number {
  return a.position.distanceTo(b.position) + TURN * a.quaternion.angleTo(b.quaternion);
}

/** how sharply the way through `a`, `b`, `c` bends at `b` (rad; 0 straight on) */
function bend(a: Required<Placement>, b: Required<Placement>, c: Required<Placement>): number {
  const into = _d.subVectors(b.position, a.position);
  const out = _e.subVectors(c.position, b.position);
  return into.lengthSq() > 1e-12 && out.lengthSq() > 1e-12 ? into.angleTo(out) : 0;
}

/** samples per span to measure a curve's length by */
const SAMPLES = 24;

/**
 * a run through `stops` in `seconds`: a centripetal Catmull–Rom curve through their positions and,
 * on the same knots, their rotations (as rotation vectors from the first), its ends extended by
 * reflection; `at` goes a share of its length (position and turn, `TURN`) along it
 */
function curve(stops: readonly Required<Placement>[], seconds: number): Run {
  const q0 = stops[0].quaternion;
  const inverse = q0.clone().invert();
  // (each placement as six numbers: where, and its turn from the first — each rotation on the side of the last)
  let last = q0.clone();
  const points = stops.map(({ position, quaternion }) => {
    const q = quaternion.clone();
    if (q.dot(last) < 0) q.set(-q.x, -q.y, -q.z, -q.w);
    last = q;
    const turn = log(inverse.clone().multiply(q), new Vector3());
    return [position.x, position.y, position.z, turn.x, turn.y, turn.z];
  });
  const n = points.length;
  const reflect = (a: number[], b: number[]) => a.map((x, k) => 2 * x - b[k]);
  const all = [reflect(points[0], points[1]), ...points, reflect(points[n - 1], points[n - 2])];
  // (centripetal knots: √ of each span's length, its turn counted; never 0, so no two knots fall together)
  const knots = [0];
  for (let i = 1; i < all.length; i++) knots.push(knots[i - 1] + Math.sqrt(Math.max(distance(all[i - 1], all[i]), 1e-9)));
  const point = (u: number, out: number[]) => {
    let i = 1;
    while (i < n - 1 && u > knots[i + 1]) i++;
    return barryGoldman(all, knots, i, u, out);
  };
  // (its length along it: SAMPLES per span)
  const us: number[] = [];
  const lengths: number[] = [];
  const was: number[] = point(knots[1], []);
  const now: number[] = [];
  let length = 0;
  for (let i = 1; i < n; i++) {
    for (let k = i === 1 ? 0 : 1; k <= SAMPLES; k++) {
      const u = knots[i] + ((knots[i + 1] - knots[i]) * k) / SAMPLES;
      point(u, now);
      length += distance(was, now);
      for (let j = 0; j < 6; j++) was[j] = now[j];
      us.push(u);
      lengths.push(length);
    }
  }
  return {
    seconds,
    at: (s, out) => {
      const want = s * length;
      let k = 1;
      while (k < lengths.length - 1 && lengths[k] < want) k++;
      const span = lengths[k] - lengths[k - 1];
      const u = us[k - 1] + (span > 0 ? (us[k] - us[k - 1]) * Math.min(1, Math.max(0, (want - lengths[k - 1]) / span)) : 0);
      const p = point(u, now);
      out.position.set(p[0], p[1], p[2]);
      return (out.quaternion.copy(q0).multiply(exp(p[3], p[4], p[5], _q)), out);
    },
  };
}

/** the length between two placements as six numbers (m: its way, and its turn × `TURN`) */
function distance(a: readonly number[], b: readonly number[]): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) + TURN * Math.hypot(a[3] - b[3], a[4] - b[4], a[5] - b[5]);
}

/** the Catmull–Rom curve on `knots` through points `i` and `i + 1` of `p` (each between its neighbours `i − 1`, `i + 2`) at `u` (Barry & Goldman's pyramid), into `out` */
function barryGoldman(p: readonly number[][], knots: readonly number[], i: number, u: number, out: number[]): number[] {
  const [t0, t1, t2, t3] = [knots[i - 1], knots[i], knots[i + 1], knots[i + 2]];
  const mix = (a: number, ta: number, b: number, tb: number) => ((tb - u) * a + (u - ta) * b) / (tb - ta);
  for (let k = 0; k < 6; k++) {
    const a1 = mix(p[i - 1][k], t0, p[i][k], t1);
    const a2 = mix(p[i][k], t1, p[i + 1][k], t2);
    const a3 = mix(p[i + 1][k], t2, p[i + 2][k], t3);
    out[k] = mix(mix(a1, t0, a2, t2), t1, mix(a2, t1, a3, t3), t2);
  }
  return out;
}

const _d = new Vector3();
const _e = new Vector3();
const _q = new Quaternion();
const _at: Required<Placement> = { position: new Vector3(), quaternion: new Quaternion() };
