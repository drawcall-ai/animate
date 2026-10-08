import { Vector3 } from 'three';
import type { Box } from '@prohuman/core';
import { jointOf } from '../src/joints';
import { forwardOf } from '../src/math';
import { comOf } from './balance';
import { holding } from './climb';
import type { Frame } from './frame';

/** both feet off the floor for longer than this is a jump (s); a running stride's flight is ~0.1 s */
export const JUMP_AIR = 0.15;

const DEG = 180 / Math.PI;

/**
 * The two-footed jumps in a run of samples: the spans with no foot planted (nor a hand
 * holding an edge: a climb) longer than JUMP_AIR, [takeoff, landing] (s) — not those a hand
 * catches or leaves a hold at (a vault's flight onto its hand and off it).
 */
export function jumpSpans(samples: readonly { t: number; planted: readonly boolean[]; held: boolean }[]): [number, number][] {
  const out: [number, number][] = [];
  let from = -1;
  for (let k = 0; k < samples.length; k++) {
    const air = !samples[k].planted.some(Boolean) && !samples[k].held;
    if (air && from < 0) from = k;
    if (air || from < 0) continue;
    const vault = samples[k].held || (from > 0 && samples[from - 1].held);
    if (samples[k].t - samples[from].t > JUMP_AIR && !vault) out.push([samples[from].t, samples[k].t]);
    from = -1;
  }
  return out;
}

/** one frame of what a jump is measured from */
interface Sample {
  t: number;
  planted: [boolean, boolean];
  /** a hand holds an edge */
  held: boolean;
  com: Vector3;
  /** the hip joints' midpoint's height (m) */
  hips: number;
  /** knee flexion, the larger of the two (°) */
  knee: number;
  /** shoulder flexion, both upper arms' mean in the heading plane (+ = forward, °) */
  shoulder: number;
  /** each foot's sole points (heel, big toe, small toe) */
  soles: [Vector3[], Vector3[]];
  obstacles: readonly Box[];
}

/** one jump's measures (m, s, °, m/s²) */
export interface Jump {
  takeoff: number;
  landing: number;
  /** the pelvis (hip joints) standing before it, its countermovement depth, and how long after the load began it was lowest (s) */
  standing: number;
  depth: number;
  toLowest: number;
  /** shoulder flexion near the lowest point (the least within 0.1 s) and at takeoff (the most within one frame) */
  backswing: number;
  armsUp: number;
  /** the feet leave and land apart by (frames) */
  leave: number;
  land: number;
  /** the centre of mass's vertical acceleration through the flight (a parabola fitted), and its apex over standing (m) */
  gravity: number;
  apex: number;
  /** its speed (m/s) and angle over the horizontal (°) as it leaves the floor */
  speed: number;
  angle: number;
  /** how far the soles stand clear of the obstacle crossed: at takeoff (toes behind the near edge) and on landing (heels past the far edge; − = inside) */
  takeoffClear: number;
  landingClear: number;
  /** the landing: the knee's peak flexion and when after contact (s) */
  landingKnee: number;
  landingKneeAt: number;
  /** how long after contact the pelvis is back within 3 cm of standing height (s; Infinity: never) */
  recovery: number;
}

/**
 * Two-footed jumps of the first actor: the countermovement (depth and timing), the arm
 * swing, the takeoff and landing (both feet together, clear of the obstacle crossed), the
 * flight (a ballistic centre of mass) and the landing's absorption and recovery.
 */
export class Flight {
  private readonly samples: Sample[] = [];
  private cached: Jump[] | null = null;

  see({ t, h, input }: Frame) {
    const j = (n: string) => jointOf(h, n);
    const fwd = forwardOf(h.yaw);
    const knee = (s: string) => 180 - j(`${s}UpperLeg`).sub(j(`${s}LowerLeg`)).angleTo(j(`${s}Foot`).sub(j(`${s}LowerLeg`))) * DEG;
    const shoulder = (s: string) => {
      const arm = j(`${s}LowerArm`).sub(j(`${s}UpperArm`));
      return Math.atan2(arm.dot(fwd), -arm.y) * DEG;
    };
    const soles = (s: string) => ['Heel', 'BigToe', 'SmallToe'].map((n) => j(`${s}${n}`));
    this.samples.push({
      t,
      // (riding, the mount carries the feet)
      planted: [h.feet[0].phase === 'planted' || h.feet[0].phase === 'carried', h.feet[1].phase === 'planted' || h.feet[1].phase === 'carried'],
      held: holding(h, input),
      com: comOf(h),
      hips: (j('leftUpperLeg').y + j('rightUpperLeg').y) / 2,
      knee: Math.max(knee('left'), knee('right')),
      shoulder: (shoulder('left') + shoulder('right')) / 2,
      soles: [soles('left'), soles('right')],
      obstacles: input.floorObstacles ?? [],
    });
    this.cached = null;
  }

  get jumps(): Jump[] {
    this.cached ??= jumpSpans(this.samples).map(([a, b]) => this.measure(a, b));
    return this.cached;
  }

  private measure(takeoff: number, landing: number): Jump {
    const S = this.samples;
    const at = (t: number) => S.findIndex((s) => s.t >= t - 1e-9);
    const up = at(takeoff);
    const down = at(landing);
    // the countermovement: the lowest pelvis in the second before takeoff, and back from it to where it stood still
    let low = up;
    for (let k = at(takeoff - 1); k < up; k++) if (S[k].hips < S[low].hips) low = k;
    let load = low;
    while (load > 0 && S[load - 1].hips - S[load].hips > 1e-4) load--;
    const standing = S[load].hips;
    const near = S.filter((s) => Math.abs(s.t - S[low].t) <= 0.1);
    // (each foot's last frame on the floor before takeoff, first on it after)
    const left = [0, 1].map((f) => {
      let k = up;
      while (k > 0 && !S[k - 1].planted[f]) k--;
      return k;
    });
    const landed = [0, 1].map((f) => {
      let k = down;
      while (k < S.length && !S[k].planted[f]) k++;
      return k;
    });
    const standCom = S[load].com.y;
    let apex = -Infinity;
    for (let k = up; k < down; k++) apex = Math.max(apex, S[k].com.y - standCom);
    // the landing's absorption: the knee's peak in the 0.4 s after contact
    let peak = down;
    for (let k = down; k < Math.min(S.length, at(landing + 0.4)); k++) if (S[k].knee > S[peak].knee) peak = k;
    let back = down;
    while (back < S.length && S[back].hips < standing - 0.03) back++;
    // the obstacle crossed: the one between where the feet took off and landed
    const from = mid(S[up - 1].soles);
    const to = mid(S[down].soles);
    const box = S[up].obstacles.find((o) => crosses(o, from, to));
    // the flight's parabola, and the velocity it starts with (horizontal: over the flight)
    const fit = parabola(S.slice(up + 1, down - 1).map((s) => [s.t - takeoff, s.com.y]));
    const rise = fit[1];
    const ahead = Math.hypot(S[down - 1].com.x - S[up].com.x, S[down - 1].com.z - S[up].com.z) / (S[down - 1].t - S[up].t);
    return {
      takeoff,
      landing,
      standing,
      depth: standing - S[low].hips,
      toLowest: S[low].t - S[load].t,
      backswing: Math.min(...near.map((s) => s.shoulder)),
      armsUp: Math.max(S[up - 1].shoulder, S[up].shoulder),
      leave: Math.abs(left[0] - left[1]),
      land: Math.abs(landed[0] - landed[1]),
      gravity: 2 * fit[2],
      apex,
      speed: Math.hypot(ahead, rise),
      angle: Math.atan2(rise, ahead) * DEG,
      takeoffClear: box ? clearance(box, S[up - 1].soles) : Infinity,
      landingClear: box ? clearance(box, S[down].soles) : Infinity,
      landingKnee: S[peak].knee,
      landingKneeAt: S[peak].t - landing,
      recovery: back < S.length ? S[back].t - landing : Infinity,
    };
  }

  toString() {
    const cm = (m: number) => (m * 100).toFixed(1);
    return (
      this.jumps
        .map(
          (m) =>
            `jump ${m.takeoff.toFixed(2)}–${m.landing.toFixed(2)} s: airborne ${(m.landing - m.takeoff).toFixed(3)} s, CoM ${m.gravity.toFixed(2)} m/s², apex ${cm(m.apex)} cm over standing, takeoff ${m.speed.toFixed(2)} m/s at ${m.angle.toFixed(0)}°; ` +
            `countermovement ${cm(m.depth)} cm, lowest ${m.toLowest.toFixed(2)} s into it; arms ${m.backswing.toFixed(0)}° near the lowest point, ${m.armsUp.toFixed(0)}° at takeoff; ` +
            `feet leave ${m.leave} and land ${m.land} frames apart, clear of the obstacle by ${cm(m.takeoffClear)} cm at takeoff and ${cm(m.landingClear)} cm on landing; ` +
            `landing knee ${m.landingKnee.toFixed(0)}° at +${m.landingKneeAt.toFixed(2)} s, pelvis back within 3 cm at +${m.recovery.toFixed(2)} s`,
        )
        .join('\n') || 'jumps: none'
    );
  }
}

/** the midpoint (x, z) of both feet's sole points */
const mid = (soles: [Vector3[], Vector3[]]) =>
  soles
    .flat()
    .reduce((a, p) => a.add(p), new Vector3())
    .multiplyScalar(1 / 6)
    .setY(0);

/** whether the line from `a` to `b` runs across the box's footprint */
function crosses(o: Box, a: Vector3, b: Vector3): boolean {
  for (let s = 0; s <= 1; s += 0.01) {
    const x = a.x + (b.x - a.x) * s;
    const z = a.z + (b.z - a.z) * s;
    if (x > o.min.x && x < o.max.x && z > o.min.z && z < o.max.z) return true;
  }
  return false;
}

/** how far the sole points lie outside the box's footprint, the closest one (− = inside) */
function clearance(o: Box, soles: [Vector3[], Vector3[]]): number {
  let near = Infinity;
  for (const p of soles.flat()) {
    const dx = Math.max(o.min.x - p.x, p.x - o.max.x);
    const dz = Math.max(o.min.z - p.z, p.z - o.max.z);
    const out = dx > 0 && dz > 0 ? Math.hypot(dx, dz) : Math.max(dx, dz);
    near = Math.min(near, out);
  }
  return near;
}

/** the least-squares parabola y = c0 + c1 t + c2 t² through (t, y) points: [c0, c1, c2] */
function parabola(pts: number[][]): number[] {
  if (pts.length < 3) return [NaN, NaN, NaN];
  const S = [0, 0, 0, 0, 0];
  const Y = [0, 0, 0];
  for (const [x, y] of pts) {
    for (let i = 0; i < 5; i++) S[i] += x ** i;
    for (let i = 0; i < 3; i++) Y[i] += y * x ** i;
  }
  // normal equations for y = c0 + c1 x + c2 x² (Cramer's rule)
  const m = [
    [S[0], S[1], S[2]],
    [S[1], S[2], S[3]],
    [S[2], S[3], S[4]],
  ];
  const det = (a: number[][]) => a[0][0] * (a[1][1] * a[2][2] - a[1][2] * a[2][1]) - a[0][1] * (a[1][0] * a[2][2] - a[1][2] * a[2][0]) + a[0][2] * (a[1][0] * a[2][1] - a[1][1] * a[2][0]);
  const D = det(m);
  return [0, 1, 2].map((c) => det(m.map((row, i) => row.map((v, k) => (k === c ? Y[i] : v)))) / D);
}
