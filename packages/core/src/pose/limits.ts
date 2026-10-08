import { Quaternion, Vector3 } from 'three';
import { CHILD_BONES, type BoneName, type ChildBone } from './bones';
import type { Rotations } from './rotations';

const DEG = Math.PI / 180;

/** an axis of the parent's frame at rest: +x left, +y up, +z forward */
type Axis = 0 | 1 | 2;
const X = 0;
const Y = 1;
const Z = 2;

/**
 * A joint's range of motion (rad), swing and twist (Baerlocher & Boulic 2001; the swing and twist
 * limits of Unreal's physics constraints, PhysX's D6 joint, Unity's CharacterJoint, FinalIK's
 * rotation limits): its bone's rotation in its parent's frame as a twist about `axis` after a
 * swing of that axis, the swing a rotation vector across it. The swing's two components (about
 * the next two axes in turn: x's y and z, y's z and x, z's x and y) and the twist each have
 * their own range (Unreal's swing 1, swing 2 and twist).
 */
interface Range {
  /** the joint's neutral: the bone's rotation in it (the T-pose's: none) */
  rest: Quaternion | null;
  axis: Axis;
  /** [lo, hi] of the swing about the first and the second cross axis, and of the twist */
  swing: [number, number, number, number];
  twist: [number, number];
}

const range = (axis: Axis, a: [number, number], b: [number, number], twist: [number, number], rest: Quaternion | null = null): Range => ({
  rest,
  axis,
  swing: [a[0] * DEG, a[1] * DEG, b[0] * DEG, b[1] * DEG],
  twist: [twist[0] * DEG, twist[1] * DEG],
});

/**
 * Each joint's range of motion (°, the left side's; the right mirrors it), in the bone's
 * parent's frame from the T-pose (the shoulder's from the arm hanging). Clinical norms of active
 * motion (AAOS: Greene & Heckman 1994; Norkin & White 2016), signs by the right-hand rule about
 * +x (left), +y (up), +z (forward):
 * - spine (lumbar) and chest (thoracic), each half of the thoracolumbar spine's flexion 80°,
 *   extension 25° (30 here), lateral flexion 35° (40) and rotation 45° (50): about x − extension,
 *   + flexion; z ± lateral flexion; y ± rotation
 * - neck and head, each half of the cervical spine's flexion 60°, extension 80°, lateral flexion
 *   50° and rotation 75° (Youdas 1992; AAOS gives 45°, 45°, 45° and 60°)
 * - clavicle (sternoclavicular; Levangie & Norkin 2011): about z depression 15° … elevation 45°;
 *   y protraction … retraction 30°; about its own axis, x: posterior rotation 50° … 10°
 * - shoulder, from the arm hanging: about z adduction (across the body) 40° … abduction 180°;
 *   x flexion 180° … extension 60°; about its axis, y: internal rotation 70° … external 90°
 * - elbow: about y flexion 150° … hyperextension 5°; z ±5° (a hinge); x half of the forearm's
 *   pronation and supination (80° each), the hand turning the other half
 * - wrist: about y radial deviation 20° … ulnar 30°; z flexion 80° … extension 70°; x the other half
 * - hip: about x flexion 120° … extension 30°; z adduction 30° … abduction 45°; y internal …
 *   external rotation 45°
 * - knee: about x hyperextension 5° … flexion 155° (a full squat's, thigh on calf: Hemmerich
 *   2006; active 135°); z ±5° (a hinge); y tibial rotation ±30°
 * - ankle, about the shank: x dorsiflexion 40° (bearing weight, a lunge: Bennell 1998; 20°
 *   unloaded) … plantarflexion 50°; z inversion 35° … eversion 15°; y the foot turned in or out
 *   (ab- and adduction of the ankle and foot together) ±20°
 * - toes (first MTP): about x extension 70° … flexion 45°; y, about their own axis z: ±10°
 */
const ANKLE = range(Y, [-35, 15], [-40, 50], [-20, 20]);
const RANGES: Partial<Record<ChildBone, Range>> = {
  spine: range(Y, [-20, 20], [-15, 40], [-25, 25]),
  chest: range(Y, [-20, 20], [-15, 40], [-25, 25]),
  neck: range(Y, [-25, 25], [-40, 30], [-37, 37]),
  head: range(Y, [-25, 25], [-40, 30], [-37, 37]),
  leftShoulder: range(X, [-30, 30], [-15, 45], [-50, 10]),
  leftUpperArm: range(Y, [-40, 180], [-180, 60], [-70, 90], new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), -Math.PI / 2)),
  leftLowerArm: range(X, [-150, 5], [-5, 5], [-45, 45]),
  leftHand: range(X, [-20, 30], [-80, 70], [-45, 45]),
  leftUpperLeg: range(Y, [-30, 45], [-120, 30], [-45, 45]),
  leftLowerLeg: range(Y, [-5, 5], [-5, 155], [-30, 30]),
  leftFoot: ANKLE,
  leftToes: range(Z, [-70, 45], [-10, 10], [-10, 10]),
};

/** how much of the twist across a lower bone and its end the lower bone takes: its share of their twists' ranges */
export function twistShare(lower: ChildBone, end: ChildBone): number {
  const span = (b: ChildBone) => {
    const t = RANGES[b]?.twist;
    if (!t) throw new Error(`no range for ${b}`);
    return t[1] - t[0];
  };
  return span(lower) / (span(lower) + span(end));
}

/** how far the ankle flexes the foot up (rad) */
export const DORSIFLEXION = -ANKLE.swing[2];

/** each bone's range and whether it is the right side's (mirrored); none for the hips, the root */
const OF = Object.fromEntries(
  CHILD_BONES.map((b) => {
    const right = b.startsWith('right');
    const r = RANGES[(right ? `left${b.slice(5)}` : b) as ChildBone];
    return [b, r ? { range: r, mirror: right } : null];
  }),
) as Record<ChildBone, { range: Range; mirror: boolean } | null>;

/** a joint eases into its limit over the last share of its range this large, and at least ZONE (rad) */
const SOFT = 0.15;
const ZONE = 5 * DEG;
/**
 * How far to take in a rotation `e` of the way to its limit (1 there; ≥ 0), `lim` rad away:
 * eased into it (C¹, never reaching it), as a factor
 */
function eased(e: number, lim: number): number {
  const z = Math.min(1, Math.max(SOFT, ZONE / lim));
  const from = 1 - z;
  return e <= from ? 1 : (from + z * Math.tanh((e - from) / z)) / e;
}
/**
 * a swing this far round (rad) nears the turn opposite the joint's axis, where its twist is
 * undefined (swung through any side, a bone arrives twisted differently): the twist's range
 * opens up from here to there
 */
const TWIST_FADE = 0.75 * Math.PI;

/**
 * `q` split by `o` into `_s` (its rotation off the joint's rest into `_p`): the swing's rotation
 * vector components about the cross axes (0, 1), the twist (2), and the limits on their sides (3,
 * 4, 5; rad)
 */
function split(q: Quaternion, o: { range: Range; mirror: boolean }) {
  const { range: r, mirror } = o;
  _p.set(q.x, mirror ? -q.y : q.y, mirror ? -q.z : q.z, q.w);
  if (r.rest) _p.multiply(_q.copy(r.rest).invert());
  const sg = _p.w < 0 ? -1 : 1;
  _c[0] = sg * _p.x;
  _c[1] = sg * _p.y;
  _c[2] = sg * _p.z;
  const w = sg * _p.w;
  const i = r.axis;
  const j = (i + 1) % 3;
  const k = (i + 2) % 3;
  // q = swing · twist: the twist is q's part about the axis, the swing q · twist⁻¹
  const ti = _c[i];
  const tl = Math.sqrt(ti * ti + w * w);
  const a = tl > 1e-9 ? ti / tl : 0;
  const b = tl > 1e-9 ? w / tl : 1;
  const sj = b * _c[j] - a * _c[k];
  const sk = b * _c[k] + a * _c[j];
  const sl = Math.sqrt(sj * sj + sk * sk);
  const phi = 2 * Math.atan2(sl, w * b + ti * a);
  const f = sl > 1e-9 ? phi / sl : 2;
  const s1 = sj * f;
  const s2 = sk * f;
  const tau = 2 * Math.atan2(a, b);
  const R = r.swing;
  const T = r.twist;
  _s[0] = s1;
  _s[1] = s2;
  _s[2] = tau;
  _s[3] = s1 >= 0 ? R[1] : -R[0];
  _s[4] = s2 >= 0 ? R[3] : -R[2];
  _s[5] = twistLimit(T, tau, phi);
}

/** the limit of range `T` on twist `tau`'s side at swing `phi` (rad) */
function twistLimit(T: [number, number], tau: number, phi: number): number {
  const lt = tau >= 0 ? T[1] : -T[0];
  return lt + (Math.PI - lt) * smooth((phi - TWIST_FADE) / (Math.PI - TWIST_FADE));
}

const smooth = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));

/**
 * Keeps each bone of `rotations` (parent-relative) in its range, as far as `weight` (0 … 1)
 * has it, easing into its limits (a joint slows into its end, no stop it hits); marks those it
 * moved in `moved`, returns whether any.
 */
export function limitRotations(rotations: Rotations, weight: Record<BoneName, number>, moved: Record<BoneName, boolean>): boolean {
  let any = false;
  for (const b of CHILD_BONES) {
    const o = OF[b];
    if (!o || weight[b] <= 0) continue;
    split(rotations[b], o);
    const s1 = _s[0] * eased(Math.abs(_s[0]) / _s[3], _s[3]);
    const s2 = _s[1] * eased(Math.abs(_s[1]) / _s[4], _s[4]);
    const phi = Math.sqrt(s1 * s1 + s2 * s2);
    // (the twist's range at the swing as limited)
    const lt = twistLimit(o.range.twist, _s[2], phi);
    const tau = _s[2] * eased(Math.abs(_s[2]) / lt, lt);
    if (s1 === _s[0] && s2 === _s[1] && tau === _s[2]) continue;
    moved[b] = any = true;
    // swing · twist, from the swing's rotation vector and the twist's angle, back onto the joint's rest
    const g = phi > 1e-9 ? Math.sin(phi / 2) / phi : 0.5;
    const sj = s1 * g;
    const sk = s2 * g;
    const sw = Math.cos(phi / 2);
    const al = Math.sin(tau / 2);
    const be = Math.cos(tau / 2);
    const i = o.range.axis;
    _c[i] = sw * al;
    _c[(i + 1) % 3] = be * sj + al * sk;
    _c[(i + 2) % 3] = be * sk - al * sj;
    _p.set(_c[0], _c[1], _c[2], sw * be);
    if (o.range.rest) _p.multiply(o.range.rest);
    _q.set(_p.x, o.mirror ? -_p.y : _p.y, o.mirror ? -_p.z : _p.z, _p.w);
    if (weight[b] < 1) rotations[b].slerp(_q, weight[b]);
    else rotations[b].copy(_q);
  }
  return any;
}

/** how far `q`, `bone`'s rotation in its parent's frame, is beyond its range (rad; 0 within it, and for the hips) */
export function beyondRange(bone: BoneName, q: Quaternion): number {
  const o = bone === 'hips' ? null : OF[bone];
  if (!o) return 0;
  split(q, o);
  return Math.max(0, Math.abs(_s[0]) - _s[3], Math.abs(_s[1]) - _s[4], Math.abs(_s[2]) - _s[5]);
}

const _c = new Float64Array(3);
const _s = new Float64Array(6);
const _p = new Quaternion();
const _q = new Quaternion();
export const zzParts = (): number[] => Array.from(_s);
