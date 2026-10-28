import { Quaternion, Vector3 } from 'three';
import type { Frame } from './frame';
import type { Placement, Goal } from './goal';
import { exp, log } from './rotation';
import { minimumJerk } from './math';

/** A waypoint's duration (s) and place (world), read every sub-step. A goal may also read the fixed course start and the preceding
 * place. `still` pauses at the preceding place. */
export type Waypoint = [seconds: number, to: Goal | ((f: Frame, start: Placement, last: Placement) => Goal)];

/** A course an item is carried along: where it is at a sub-step (`to`), and whether it has gone all its way (`over`). */
export type Course = ReturnType<typeof course>;

/**
 * A course (world) from where `item` is when it is first read, through its waypoints' placements as one smooth curve (centripetal
 * Catmull–Rom, the rotation turned along it), timed by one minimum-jerk profile over its whole length that takes as long as its
 * waypoints together, `pace` times as fast as they say: it passes its placements on the way without stopping and comes to rest only
 * at the end — and where a waypoint holds still (`still`) or the way turns back on itself (by more than 135°: the hand stops to
 * reverse), it comes to rest there and sets off again. It sets off `delay` s after it is first read.
 * With `on`, its starting placement follows that moving approach frame throughout the course.
 */
export function course(item: { readonly current: Placement }, waypoints: readonly Waypoint[], { pace = 1, delay = 0, on }: { pace?: number; delay?: number; on?: (f: Frame) => Goal } = {}) {
  let start = NaN;
  let runs: Run[] = [];
  let from: Placement | undefined, carriedBy: object | undefined;
  let relative: Placement | undefined;
  const moving = on !== undefined || waypoints.some(([, to]) => typeof to === 'function');
  const total = waypoints.reduce((sum, [seconds]) => sum + seconds / pace, 0);
  const to = (f: Frame): Placement & Goal => {
    const anchor = on?.(f), turn = anchor?.quaternion ?? IDENTITY;
    if (from === undefined) {
      start = f.time;
      from = { position: item.current.position.clone(), quaternion: item.current.quaternion.clone() };
      if (anchor) {
        const inverse = turn.clone().invert();
        relative = { position: from.position.clone().sub(anchor.position).applyQuaternion(inverse),
          quaternion: inverse.multiply(from.quaternion) };
      }
    }
    // An insertion starts on its moving approach, not at the world position that approach occupied at take-off.
    if (anchor && relative) {
      from.position.copy(relative.position).applyQuaternion(turn).add(anchor.position);
      from.quaternion.copy(turn).multiply(relative.quaternion);
    }
    if (!runs.length || moving) {
      const stops: Placement[] = [from];
      for (const [, point] of waypoints) {
        const last = stops[stops.length - 1];
        const next = typeof point === 'function' ? point(f, from, last) : point;
        carriedBy = next.carriedBy;
        stops.push({ position: next.position.clone(), quaternion: (next.quaternion ?? last.quaternion).clone() });
      }
      runs = runsOf(stops, waypoints.map(([seconds]) => seconds / pace));
    }
    let t = Math.max(0, f.time - start - delay);
    let i = 0;
    while (i < runs.length - 1 && t > runs[i].seconds) t -= runs[i++].seconds;
    const { position, quaternion } = runs[i].at(minimumJerk(t / runs[i].seconds), _at);
    return { position: position.clone(), quaternion: quaternion.clone(), carriedBy };
  };
  return { to, over: (f: Frame) => !Number.isNaN(start) && f.time - start >= delay + total };
}

/** a waypoint that stays where the one before ended: a moment held still */
export const still = (_f: Frame, _start: Placement, last: Placement) => last;

/** a stretch of a course gone without stopping: how long it takes (s), and where it is a share `s` of its length along */
type Run = ReturnType<typeof curve>;

/** how far a turn counts as going along a course (m per rad): a hand turning what it holds about its grip moves its far side about so much */
const TURN = 0.1;
/** how sharply the way may bend at a placement and still be passed without stopping (rad): a hand sweeps round a bend, but stops to go back the way it came */
const REVERSE = (3 * Math.PI) / 4;

/** the course through `stops`, each waypoint taking `seconds`, cut into runs where it holds still or turns back on itself */
function runsOf(stops: readonly Placement[], seconds: readonly number[]): Run[] {
  const runs: Run[] = [];
  let first = 0;
  let time = 0;
  for (let i = 0; i < seconds.length; i++) {
    time += seconds[i];
    const end = i === seconds.length - 1;
    const held = lengthOf(stops[i], stops[i + 1]) < 1e-6;
    const next = !end && lengthOf(stops[i + 1], stops[i + 2]) < 1e-6;
    const back = !end && !next && !held && bend(stops[i], stops[i + 1], stops[i + 2]) > REVERSE;
    if (!held && !end && !next && !back) continue;
    runs.push(held ? stay(stops[i], time) : curve(stops.slice(first, i + 2), time));
    first = i + 1;
    time = 0;
  }
  return runs;
}

/** a run staying at `at` for `seconds` */
function stay(at: Placement, seconds: number): Run {
  return { seconds, at: (_, out) => (out.position.copy(at.position), out.quaternion.copy(at.quaternion), out) };
}

/** how long the way from `a` to `b` is (m): its way and its turn (`TURN`) */
function lengthOf(a: Placement, b: Placement): number {
  return a.position.distanceTo(b.position) + TURN * a.quaternion.angleTo(b.quaternion);
}

/** how sharply the way through `a`, `b`, `c` bends at `b` (rad; 0 straight on) */
function bend(a: Placement, b: Placement, c: Placement): number {
  const into = _d.subVectors(b.position, a.position);
  const out = _e.subVectors(c.position, b.position);
  return into.lengthSq() > 1e-12 && out.lengthSq() > 1e-12 ? into.angleTo(out) : 0;
}

/** samples per span to measure a curve's length by */
const SAMPLES = 24;

/** a run through `stops` in `seconds`: a centripetal Catmull–Rom curve through their positions and, on the same knots, their rotations
 * (as rotation vectors from the first), its ends extended by reflection; `at` goes a share of its length (position and turn, `TURN`)
 * along it */
function curve(stops: readonly Placement[], seconds: number) {
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
    at: (s: number, out: Placement) => {
      const want = s * length;
      let k = 1;
      while (k < lengths.length - 1 && lengths[k] < want) k++;
      const span = lengths[k] - lengths[k - 1];
      const u = us[k - 1] + (span > 0 ? (us[k] - us[k - 1]) * Math.min(1, Math.max(0, (want - lengths[k - 1]) / span)) : 0);
      const at = point(u, now);
      out.position.set(at[0], at[1], at[2]);
      return (out.quaternion.copy(q0).multiply(exp(at[3], at[4], at[5], _q)), out);
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

const [_d, _e] = [new Vector3(), new Vector3()];
const _q = new Quaternion(), IDENTITY = new Quaternion();
const _at: Placement = { position: new Vector3(), quaternion: new Quaternion() };

