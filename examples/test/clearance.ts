import { Quaternion, Vector3 } from 'three';
import { jointOf } from '../src/joints';
import type { Frame } from './frame';

/**
 * The body as capsules between joints (radii × height: a lean adult's limbs and trunk; Winter's
 * segment girths), each by its own name (a limb's that of the bone it starts at); the hands out
 * from the wrists along the forearms (the hand's length 0.108 H, Drillis & Contini); the head a
 * ball round the skull's centre.
 */
const LIMBS: [name: string, from: string, to: string, radius: number][] = [
  ['trunk', 'hips', 'chest', 0.06],
  ['thorax', 'chest', 'neck', 0.045],
  ['neck', 'neck', 'head', 0.03],
  ['pelvis', 'leftUpperLeg', 'rightUpperLeg', 0.045],
  ['shoulders', 'leftUpperArm', 'rightUpperArm', 0.035],
  ...(['left', 'right'] as const).flatMap((s): [string, string, string, number][] => [
    [`${s}UpperArm`, `${s}UpperArm`, `${s}LowerArm`, 0.026],
    [`${s}LowerArm`, `${s}LowerArm`, `${s}Hand`, 0.022],
    [`${s}UpperLeg`, `${s}UpperLeg`, `${s}LowerLeg`, 0.038],
    [`${s}LowerLeg`, `${s}LowerLeg`, `${s}Foot`, 0.028],
  ]),
];
/** a hand: how far it reaches out from the wrist along the forearm, and its half-thickness (× height) */
const HAND = { length: 0.08, radius: 0.013 };
/** the skull: its centre in the head bone's frame and its radius (× height) */
const SKULL = { centre: new Vector3(0, 0.063, 0.011), radius: 0.06 };

/**
 * How far the items a body handles reach into it: each solid (a thickened segment the scenario
 * gives, `Stage.solids`) against each body capsule but those it may touch (that wear or bear it, a hand holding it and its forearm); the
 * deepest overlap (m), what and where, and the frames judged.
 */
export class Clearance {
  depth = 0;
  at = 0;
  what = '';
  frames = 0;

  see({ t, h, solids }: Frame) {
    if (solids.length === 0) return;
    this.frames++;
    const H = h.proportions.height;
    const head = h.model.scene.getObjectByName('head');
    if (!head) throw new Error('no head');
    const skull = SKULL.centre.clone().multiplyScalar(H).applyQuaternion(head.getWorldQuaternion(new Quaternion())).add(head.getWorldPosition(new Vector3()));
    const hand = (s: 'left' | 'right') => {
      const wrist = jointOf(h, `${s}Hand`);
      return { name: `${s}Hand`, a: wrist, b: wrist.clone().sub(jointOf(h, `${s}LowerArm`)).setLength(HAND.length * H).add(wrist), r: HAND.radius * H };
    };
    const parts = [...LIMBS.map(([name, from, to, r]) => ({ name, a: jointOf(h, from), b: jointOf(h, to), r: r * H })), hand('left'), hand('right'), { name: 'head', a: skull, b: skull, r: SKULL.radius * H }];
    for (const s of solids) {
      for (const p of parts) {
        if (s.touches.includes(p.name) || (['left', 'right'] as const).some((side) => (p.name === `${side}Hand` || p.name === `${side}LowerArm`) && s.item && h.holding[side]?.item === s.item)) continue;
        const depth = s.radius + p.r - segmentDistance(s.a, s.b, p.a, p.b);
        if (depth <= this.depth) continue;
        [this.depth, this.at, this.what] = [depth, t, `${s.name} into ${p.name}`];
      }
    }
  }

  toString() {
    return this.frames ? `items into the body: deepest ${this.depth.toFixed(3)} m (${this.what || '–'} @${this.at.toFixed(2)}s; ${this.frames} frames)` : 'items into the body: none handled';
  }
}

/** the least distance between segments `a`–`b` and `c`–`d` (their closest points left in `_p`, `_q`) */
export function segmentDistance(a: Vector3, b: Vector3, c: Vector3, d: Vector3): number {
  const u = _u.subVectors(b, a);
  const v = _v.subVectors(d, c);
  const w = _w.subVectors(a, c);
  const uu = u.dot(u);
  const vv = v.dot(v);
  const uv = u.dot(v);
  const uw = u.dot(w);
  const vw = v.dot(w);
  const det = uu * vv - uv * uv;
  // (the closest points' parameters, each clamped to its segment and the other's redone for it)
  let s = det > 1e-12 ? clamp01((uv * vw - vv * uw) / det) : 0;
  let r = vv > 1e-12 ? clamp01((uv * s + vw) / vv) : 0;
  s = uu > 1e-12 ? clamp01((uv * r - uw) / uu) : 0;
  r = vv > 1e-12 ? clamp01((uv * s + vw) / vv) : 0;
  return _p.copy(a).addScaledVector(u, s).distanceTo(_q.copy(c).addScaledVector(v, r));
}

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const _u = new Vector3();
const _v = new Vector3();
const _w = new Vector3();
const _p = new Vector3();
const _q = new Vector3();

/**
 * How much further than straight arm `side` reaches for `target` (world) going round the front of its own trunk (m): 0 while the
 * straight line from its shoulder to the target keeps a forearm's radius off the trunk's capsules; else that line bent forward round
 * the capsule it cuts deepest — from the shoulder to the point a forearm's radius in front of the trunk's axis there (the hips'
 * facing), on to the target — less the straight line. The longest such way round of the two capsules.
 */
export function aroundTheTrunk(h: Frame['h'], side: 'left' | 'right', target: Vector3): number {
  const H = h.proportions.height;
  const hips = h.model.scene.getObjectByName('hips');
  if (!hips) throw new Error('no hips');
  const front = new Vector3(0, 0, 1).applyQuaternion(hips.getWorldQuaternion(new Quaternion())).setY(0).normalize();
  const shoulder = jointOf(h, `${side}UpperArm`), straight = shoulder.distanceTo(target);
  const forearm = LIMBS.find(([n]) => n === `${side}LowerArm`)?.[3] ?? 0;
  let most = 0;
  for (const [, from, to, r] of LIMBS.filter(([n]) => n === 'trunk' || n === 'thorax')) {
    const clear = (r + forearm) * H;
    if (segmentDistance(shoulder, target, jointOf(h, from), jointOf(h, to)) >= clear) continue;
    // (`segmentDistance` leaves the closest point on the trunk's axis in `_q`)
    const by = _q.clone().addScaledVector(front, clear);
    most = Math.max(most, shoulder.distanceTo(by) + by.distanceTo(target) - straight);
  }
  return most;
}

/** how far arm `side`'s upper arm, forearm and hand reach into the trunk (its pelvis-to-chest and chest-to-neck capsules; m) */
export function armInTrunk(h: Frame['h'], side: 'left' | 'right'): number {
  const H = h.proportions.height;
  const limb = (name: string) => LIMBS.find(([n]) => n === name) ?? [name, '', '', 0];
  const capsule = ([, from, to, r]: (typeof LIMBS)[number]) => ({ a: jointOf(h, from), b: jointOf(h, to), r: r * H });
  const wrist = jointOf(h, `${side}Hand`);
  const arm = [capsule(limb(`${side}UpperArm`)), capsule(limb(`${side}LowerArm`)), { a: wrist, b: wrist.clone().sub(jointOf(h, `${side}LowerArm`)).setLength(HAND.length * H).add(wrist), r: HAND.radius * H }];
  const trunk = [capsule(limb('trunk')), capsule(limb('thorax'))];
  return Math.max(...arm.flatMap((p) => trunk.map((t) => p.r + t.r - segmentDistance(p.a, p.b, t.a, t.b))));
}
