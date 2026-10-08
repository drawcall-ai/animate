import { Vector3 } from 'three';
import type { Box, Humanoid, Ladder } from '@prohuman/core';
import { onLadder } from './ladder';
import { jointOf } from '../src/joints';
import { FIXED_DT } from '../src/scenario';
import type { Frame } from './frame';

const DEG = 180 / Math.PI;

/** a wrist this close to a top edge of a ground box holds it (m, default body): the hand hooked over it or pressing on it */
const HOLD = 0.07;
/**
 * the body's points kept out of the ground boxes, and how far their surface lies out from
 * them (× height): the soles (on it), knees, hip joints, trunk, head, wrists (on it)
 */
export const PARTS = {
  sole: { r: 0, joints: ['leftHeel', 'leftBigToe', 'leftSmallToe', 'rightHeel', 'rightBigToe', 'rightSmallToe'] },
  knee: { r: 0.025, joints: ['leftLowerLeg', 'rightLowerLeg'] },
  hip: { r: 0.04, joints: ['leftUpperLeg', 'rightUpperLeg'] },
  trunk: { r: 0.05, joints: ['hips', 'spine', 'chest', 'neck'] },
  head: { r: 0.05, joints: ['head'] },
  hand: { r: 0, joints: ['leftHand', 'rightHand'] },
} as const;
export type Part = keyof typeof PARTS;
/** the joint angles whose speed is judged: knee, elbow, hip (thigh to trunk), shoulder (upper arm to trunk) */
const ANGLES = ['knee', 'elbow', 'hip', 'shoulder'] as const;
type Angle = (typeof ANGLES)[number];

/** how far a point lies inside a box (m; − = outside, by that much) */
export function depthIn(o: Box, p: Vector3): number {
  const dx = Math.max(o.min.x - p.x, p.x - o.max.x);
  const dy = Math.max(o.min.y - p.y, p.y - o.max.y);
  const dz = Math.max(o.min.z - p.z, p.z - o.max.z);
  const out = Math.hypot(Math.max(0, dx), Math.max(0, dy), Math.max(0, dz));
  return out > 0 ? -out : -Math.max(dx, dy, dz);
}

/** how far a point lies from the nearest top edge of a box (m) */
function edgeDistance(o: Box, p: Vector3): number {
  const y = p.y - o.max.y;
  // (the top's four edges: along x at z = min/max, along z at x = min/max)
  const ax = Math.max(o.min.x - p.x, 0, p.x - o.max.x);
  const az = Math.max(o.min.z - p.z, 0, p.z - o.max.z);
  return Math.min(
    Math.hypot(ax, y, p.z - o.min.z),
    Math.hypot(ax, y, p.z - o.max.z),
    Math.hypot(p.x - o.min.x, y, az),
    Math.hypot(p.x - o.max.x, y, az),
  );
}

/** how far each wrist [left, right] is from the nearest top edge of the ground boxes (m) */
function wristEdges(h: Humanoid, ground: readonly Box[]): [number, number] {
  const d = (s: string) => Math.min(Infinity, ...ground.map((o) => edgeDistance(o, jointOf(h, `${s}Hand`))));
  return [d('left'), d('right')];
}

/** a wrist this close above the top of a floor obstacle presses on it (m, default body) */
const PRESS = 0.07;

/** a hand holds the edge of a ground box or a ladder, or presses on a floor obstacle's top: the body hangs from it or leans on it (supported without its feet) */
export function holding(h: Humanoid, input: { ground?: readonly Box[]; floorObstacles?: readonly Box[]; ladders?: readonly Ladder[] }): boolean {
  const { ground = [], floorObstacles = [] } = input;
  if (onLadder(h, input.ladders)) return true;
  if (ground.length && wristEdges(h, ground).some((e) => e < HOLD * h.proportions.scale)) return true;
  return floorObstacles.some((o) => (['left', 'right'] as const).some((s) => onTop(o, jointOf(h, `${s}Hand`), PRESS * h.proportions.scale)));
}

/** a point over box `o`'s top, within `near` above it */
export const onTop = (o: Box, p: Vector3, near: number) => p.x >= o.min.x && p.x <= o.max.x && p.z >= o.min.z && p.z <= o.max.z && p.y - o.max.y < near && p.y > o.max.y - 0.02;

interface Sample {
  t: number;
  /** the wrists' distance from the edge */
  wrists: [number, number];
  /** the deepest each part reaches into a ground box (m, with its radius) */
  depth: Record<Part, number>;
  /** the hip joints' midpoint's height, and the lowest sole point's of each foot */
  hips: number;
  soles: [number, number];
  /** planted feet on the highest ground */
  onTop: [boolean, boolean];
  /** the model's root */
  root: Vector3;
  /** the joint angles (°), the larger of the two sides' changes counting */
  angles: Record<Angle, [number, number]>;
}

/** one climb's measures (m, s, °/s, m/s²) */
export interface ClimbMeasure {
  top: number;
  /** both hands on the edge; the first foot, and both, set on top; standing on top (both feet, the hips up) */
  grab: number;
  firstFoot: number;
  bothFeet: number;
  standing: number;
  /** from the grab to the first foot on top: the wrists' farthest from the edge, and frames a hand is off it */
  wrist: number;
  handsOff: number;
  /** the deepest each part reached into the box */
  depth: Record<Part, number>;
  /** the hip joints over the edge as the last foot comes up past it */
  hipsOver: number;
  /** the root's peak speed and acceleration, the joints' peak angular speed (from a second before the grab to standing) */
  speed: number;
  accel: number;
  rates: Record<Angle, number>;
  /** when each peaked (s) */
  accelAt: number;
  ratesAt: Record<Angle, number>;
}

/**
 * Climbs onto ground boxes (a hand holding an edge, then standing on top), of the first actor:
 * hands on the edge from the grab until a foot is on top, nothing of the body inside the box,
 * the hips over the edge before the last foot comes up, and a continuous motion (the root's
 * speed and acceleration, the joints' angular speeds).
 */
export class Climbing {
  private readonly samples: Sample[] = [];
  private ground: readonly Box[] = [];
  /** how close to the edge a wrist holds it (m) */
  private hold = HOLD;
  private cached: ClimbMeasure[] | null = null;

  see({ t, h, input }: Frame) {
    const ground = input.ground ?? [];
    if (!ground.length) return;
    this.ground = ground;
    this.hold = HOLD * h.proportions.scale;
    const H = h.proportions.height;
    const j = (n: string) => jointOf(h, n);
    const depth = {} as Record<Part, number>;
    for (const k of Object.keys(PARTS) as Part[]) {
      const { r, joints } = PARTS[k];
      depth[k] = Math.max(...joints.flatMap((n) => ground.map((o) => depthIn(o, j(n)) + r * H)));
    }
    const top = Math.max(...ground.map((o) => o.max.y));
    const sole = (s: string) => Math.min(...['Heel', 'BigToe', 'SmallToe'].map((n) => j(`${s}${n}`).y));
    const angle = (a: Vector3, b: Vector3, c: Vector3) => 180 - a.clone().sub(b).angleTo(c.clone().sub(b)) * DEG;
    const up = j('neck').sub(j('hips'));
    const trunkAngle = (joint: Vector3, end: Vector3) => end.clone().sub(joint).angleTo(up.clone().negate()) * DEG;
    const side = (s: string) => ({
      knee: angle(j(`${s}UpperLeg`), j(`${s}LowerLeg`), j(`${s}Foot`)),
      elbow: angle(j(`${s}UpperArm`), j(`${s}LowerArm`), j(`${s}Hand`)),
      hip: trunkAngle(j(`${s}UpperLeg`), j(`${s}LowerLeg`)),
      shoulder: 180 - trunkAngle(j(`${s}UpperArm`), j(`${s}LowerArm`)),
    });
    const l = side('left');
    const r = side('right');
    this.samples.push({
      t,
      wrists: wristEdges(h, ground),
      depth,
      hips: (j('leftUpperLeg').y + j('rightUpperLeg').y) / 2,
      soles: [sole('left'), sole('right')],
      onTop: [0, 1].map((s) => h.feet[s].phase === 'planted' && h.feet[s].position.y > top) as [boolean, boolean],
      root: h.model.scene.position.clone(),
      angles: Object.fromEntries(ANGLES.map((k) => [k, [l[k], r[k]]])) as Record<Angle, [number, number]>,
    });
    this.cached = null;
  }

  get climbs(): ClimbMeasure[] {
    this.cached ??= this.measure();
    return this.cached;
  }

  private measure(): ClimbMeasure[] {
    const S = this.samples;
    const hold = (k: number) => S[k].wrists.map((w) => w < this.hold);
    const grab = S.findIndex((_, k) => hold(k).every(Boolean));
    if (grab < 0) return [];
    const top = Math.max(...this.ground.map((o) => o.max.y));
    const after = (from: number, ok: (s: Sample) => boolean) => {
      const k = S.findIndex((s, i) => i >= from && ok(s));
      return k < 0 ? S.length - 1 : k;
    };
    const firstFoot = after(grab, (s) => s.onTop.some(Boolean));
    const bothFeet = after(grab, (s) => s.onTop.every(Boolean));
    const standHips = S[Math.max(0, grab - 60)].hips;
    const standing = after(bothFeet, (s) => s.hips > top + standHips - 0.02);
    let wrist = 0;
    let handsOff = 0;
    for (let k = grab; k <= firstFoot; k++) {
      wrist = Math.max(wrist, ...S[k].wrists);
      if (!hold(k).every(Boolean)) handsOff++;
    }
    const depth = {} as Record<Part, number>;
    for (const p of Object.keys(PARTS) as Part[]) depth[p] = Math.max(...S.map((s) => s.depth[p]));
    // the last sole to come up past the edge (from below it, not stepping about on top), and the hips then
    let last = grab;
    const below = top - 0.05;
    for (let k = grab + 1; k < S.length; k++) for (const f of [0, 1]) if (S[k - 1].soles[f] < below && S[k].soles[f] >= below) last = k;
    // the motion from a second before the grab to standing
    const from = Math.max(1, grab - 60);
    let speed = 0;
    let accel = 0;
    let accelAt = 0;
    const rates = Object.fromEntries(ANGLES.map((k) => [k, 0])) as Record<Angle, number>;
    const ratesAt = { ...rates };
    for (let k = from + 1; k <= standing; k++) {
      const v1 = S[k].root.clone().sub(S[k - 1].root).divideScalar(FIXED_DT);
      const v0 = S[k - 1].root.clone().sub(S[k - 2].root).divideScalar(FIXED_DT);
      speed = Math.max(speed, v1.length());
      const a1 = v1.sub(v0).length() / FIXED_DT;
      if (a1 > accel) [accel, accelAt] = [a1, S[k].t];
      for (const a of ANGLES)
        for (const s of [0, 1]) {
          const r = Math.abs(S[k].angles[a][s] - S[k - 1].angles[a][s]) / FIXED_DT;
          if (r > rates[a]) [rates[a], ratesAt[a]] = [r, S[k].t];
        }
    }
    return [
      {
        top,
        grab: S[grab].t,
        firstFoot: S[firstFoot].t,
        bothFeet: S[bothFeet].t,
        standing: S[standing].t,
        wrist,
        handsOff,
        depth,
        hipsOver: S[last].hips - top,
        speed,
        accel,
        rates,
        accelAt,
        ratesAt,
      },
    ];
  }

  toString() {
    const cm = (m: number) => (m * 100).toFixed(1);
    return (
      this.climbs
        .map(
          (c) =>
            `climb onto ${c.top.toFixed(2)} m: grab ${c.grab.toFixed(2)} s, first foot on top +${(c.firstFoot - c.grab).toFixed(2)} s, both +${(c.bothFeet - c.grab).toFixed(2)} s, standing +${(c.standing - c.grab).toFixed(2)} s; ` +
            `wrists within ${cm(c.wrist)} cm of the edge, ${c.handsOff} frames a hand off; ` +
            `deepest into the box: ${Object.entries(c.depth).map(([k, v]) => `${k} ${cm(v)}`).join(', ')} cm; hips ${cm(c.hipsOver)} cm over the edge as the last foot comes up; ` +
            `root peak ${c.speed.toFixed(2)} m/s, ${c.accel.toFixed(1)} m/s² @${c.accelAt.toFixed(2)}s; joints peak ${Object.entries(c.rates).map(([k, v]) => `${k} ${v.toFixed(0)} @${c.ratesAt[k as Angle].toFixed(2)}s`).join(', ')} °/s`,
        )
        .join('\n') || 'climbs: none'
    );
  }
}
