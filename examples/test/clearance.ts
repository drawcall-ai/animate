import { Quaternion, Vector3 } from 'three';
import { jointOf } from '../src/joints';
import type { Frame } from './frame';

/**
 * The body as capsules between joints (radii × height: a lean adult's limbs and trunk; Winter's
 * segment girths), each named by the bone it starts at; the head a ball round the skull's centre.
 */
const LIMBS: [from: string, to: string, radius: number][] = [
  ['hips', 'chest', 0.06],
  ['chest', 'neck', 0.045],
  ['neck', 'head', 0.03],
  ['leftUpperLeg', 'rightUpperLeg', 0.045],
  ['leftUpperArm', 'rightUpperArm', 0.035],
  ['leftUpperArm', 'leftLowerArm', 0.026],
  ['rightUpperArm', 'rightLowerArm', 0.026],
  ['leftLowerArm', 'leftHand', 0.022],
  ['rightLowerArm', 'rightHand', 0.022],
  ['leftUpperLeg', 'leftLowerLeg', 0.038],
  ['rightUpperLeg', 'rightLowerLeg', 0.038],
  ['leftLowerLeg', 'leftFoot', 0.028],
  ['rightLowerLeg', 'rightFoot', 0.028],
];
/** the skull: its centre in the head bone's frame and its radius (× height) */
const SKULL = { centre: new Vector3(0, 0.063, 0.011), radius: 0.06 };

/**
 * How far the items a body handles reach into it: each solid (a thickened segment the scenario
 * gives, `Stage.solids`) against each body capsule but those of the bones that hold or wear it; the
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
    const parts = [
      ...LIMBS.map(([from, to, r]) => ({ name: from === 'hips' ? 'trunk' : from === 'chest' ? 'thorax' : from, a: jointOf(h, from), b: jointOf(h, to), r: r * H })),
      { name: 'head', a: skull, b: skull, r: SKULL.radius * H },
    ];
    for (const s of solids) {
      for (const p of parts) {
        if (s.touches.includes(p.name)) continue;
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

/** the least distance between segments `a`–`b` and `c`–`d` */
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
