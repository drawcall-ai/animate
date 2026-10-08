import { Quaternion, Vector3 } from 'three';
import type { Proportions } from '../proportions';
import { isSphere, type Box, type Sphere } from '../input';
import { forwardOf, framePoint, hypot, leftOf, quatYXZ, segmentDistance, yawOf } from '../math';
import type { Stance } from '../stance';
import { createHeadFrame, type HeadFrame, type TrunkFrame } from '../pose/frames';
import { MASS } from '../pose/mass';

/**
 * Trunk posture parameters. The same vector is used by the "planner" (where
 * should I stand?) and the "posture" solve (how do I hold my trunk given
 * where I stand?).
 */
export const P = {
  X: 0, // support centre (between the feet), world x
  Z: 1, // support centre, world z
  YAW: 2, // facing yaw
  DROP: 3, // pelvis drop below standing hip height (m) → knee/hip flexion
  SHIFT: 4, // pelvis fore/aft shift relative to the support centre (m)
  HIP: 5, // trunk flexion at the hip joints (rad, + forward)
  SPINE: 6, // additional lumbar/thoracic flexion (rad)
  ROLL: 7, // lateral trunk bend (rad, + raises left side)
  TWIST: 8, // axial trunk rotation, chest vs pelvis (rad, + = chest turns left)
  SIDE: 9, // pelvis lateral shift (m, + = left)
} as const;
export const NP = 10;

/** the self-collision proxies' radii (× height): the trunk capsule, the head sphere */
const TRUNK_RADIUS = 0.065;
const HEAD_RADIUS = 0.06;
/** scratch: the head held level on the posture's neck */
const _level = createHeadFrame();

/** the mass the posture moves (head, trunk, pelvis with the thighs' share) */
const TRUNK_MASS = MASS.head + MASS.spine + MASS.chest + MASS.pelvis;

/** Offsets layered on the solved trunk posture, not optimised: the gait's oscillations and the trunk's inertia. */
export interface Overlay {
  pelvisYaw: number;
  pelvisRoll: number;
  chestYaw: number;
  /** vertical pelvis offset (bob, walking height) */
  readonly lift: number;
  /** lateral pelvis sway (m, + = left) */
  side: number;
  /** fore-aft pelvis shift (m, + = forward) */
  shift: number;
  /** where balance holds the centre of mass standing, off the support's centre (m, forward and left): postural sway */
  swayAhead: number;
  swayLeft: number;
  /** extra trunk flexion (walking / acceleration lean) */
  lean: number;
  /** extra lateral bend of the chest (inertia, impacts) */
  chestRoll: number;
  /** the gait's roll of the thorax, shared by the spine and chest */
  thoraxRoll: number;
  /** riding: the whole body's inclination into the mount's acceleration, about `pivot` */
  tilt: Quaternion | null;
  readonly pivot: Vector3;
}

export const ZERO_OVERLAY: Overlay = { pelvisYaw: 0, pelvisRoll: 0, chestYaw: 0, lift: 0, side: 0, shift: 0, swayAhead: 0, swayLeft: 0, lean: 0, chestRoll: 0, thoraxRoll: 0, tilt: null, pivot: new Vector3() };
const _q = new Quaternion();
const _qLevel = new Quaternion();
const ZERO = { x: 0, y: 0, z: 0 };
const _v = new Vector3();
const _w = new Vector3();

/** Neck and head for a head rotation: the lower neck takes ~40% of the head's rotation relative to the chest. */
export function headFrom(d: Proportions, neck: Vector3, qChest: Quaternion, qHead: Quaternion, out: HeadFrame) {
  const rel = _q.copy(qChest).invert().multiply(qHead);
  const f = _v.set(0, 0, 1).applyQuaternion(rel);
  const yaw = Math.atan2(f.x, f.z);
  const pitch = Math.atan2(-f.y, hypot(f.x, f.z));
  quatYXZ(yaw * 0.4, pitch * 0.4, 0, out.qNeck).premultiply(qChest);
  framePoint(out.head, neck, out.qNeck, d.offsets.head);
  out.qHead.copy(qHead);
  framePoint(out.headCenter, out.head, qHead, d.headCenter);
  framePoint(out.eyes, out.head, qHead, d.eyes);
}

/**
 * Forward kinematics of the trunk for posture parameters `p`, plus the gait overlay and
 * `legLift`: how far the legs lower the pelvis to reach their feet (m, ≤ 0).
 */
export function trunkFK(p: Float64Array, d: Proportions, stance: Stance, out: TrunkFrame, ov = ZERO_OVERLAY, qHead: Quaternion | null = null, legLift = 0) {
  const o = d.offsets;
  const yaw = p[P.YAW] + stance.blade;
  const f = forwardOf(yaw, out.forward);
  const l = leftOf(yaw, out.left);
  const shift = p[P.SHIFT] + ov.shift;
  const side = p[P.SIDE] + ov.side;
  const height = d.hipHeight - p[P.DROP] + (ov.lift + legLift);
  out.hips.set(p[P.X] + f.x * shift + l.x * side, height + f.y * shift + l.y * side, p[P.Z] + f.z * shift + l.z * side);

  // the trunk bends and twists over the pelvis: the spine takes 40–45% of it, the chest the
  // rest. The gait's pelvic list tilts the pelvis about the lumbosacral joint, and the lumbar
  // spine takes it out again: the trunk rides upright and smoothly over it.
  const spine = p[P.SPINE];
  const roll = p[P.ROLL];
  const twist = p[P.TWIST];
  const pitch = p[P.HIP] + ov.lean;
  quatYXZ(yaw + ov.pelvisYaw, pitch, roll * 0.25 + ov.pelvisRoll, out.qHips);
  if (ov.pelvisRoll !== 0) {
    framePoint(_v, ZERO, quatYXZ(yaw + ov.pelvisYaw, pitch, roll * 0.25, _q), o.spine);
    out.hips.add(_v).sub(framePoint(_w, ZERO, out.qHips, o.spine));
  }
  if (ov.tilt) {
    out.hips.sub(ov.pivot).applyQuaternion(ov.tilt).add(ov.pivot);
    out.qHips.premultiply(ov.tilt);
  }
  out.qSpine.copy(out.qHips).multiply(quatYXZ(twist * 0.4 - ov.chestYaw * 0.3, spine * 0.45, roll * 0.35 - ov.pelvisRoll + ov.thoraxRoll * 0.4, _q));
  out.qChest.copy(out.qSpine).multiply(quatYXZ(twist * 0.6 - ov.chestYaw * 0.7, spine * 0.55, roll * 0.4 + ov.chestRoll + ov.thoraxRoll * 0.6, _q));
  framePoint(out.upperLegs[0], out.hips, out.qHips, o.leftUpperLeg);
  framePoint(out.upperLegs[1], out.hips, out.qHips, o.rightUpperLeg);
  framePoint(out.spine, out.hips, out.qHips, o.spine);
  framePoint(out.chest, out.spine, out.qSpine, o.chest);
  framePoint(out.neck, out.chest, out.qChest, o.neck);
  framePoint(out.shoulders[0], out.chest, out.qChest, o.leftShoulder);
  framePoint(out.shoulders[1], out.chest, out.qChest, o.rightShoulder);
  framePoint(out.upperArms[0], out.shoulders[0], out.qChest, o.leftUpperArm);
  framePoint(out.upperArms[1], out.shoulders[1], out.qChest, o.rightUpperArm);
  headFrom(d, out.neck, out.qChest, qHead ?? out.qChest, out);
}

/**
 * How deep an obstacle reaches into the trunk capsule (hips→neck) or the head
 * (self-collision proxies; ≤ 0 when clear). A box is cleared vertically, under it or over
 * it (a low ceiling, a table top: the body walks on beneath it), with the head held level
 * on the neck, looking ahead as the gaze holds it, and taken out to its crown.
 */
export function obstacleDepth(o: Sphere | Box, f: TrunkFrame, d: Proportions): number {
  const trunkR = TRUNK_RADIUS * d.height;
  if (isSphere(o)) {
    const headR = HEAD_RADIUS * d.height;
    return Math.max(
      o.radius + trunkR - segmentDistance(o.center, f.hips, f.spine),
      o.radius + trunkR - segmentDistance(o.center, f.spine, f.chest),
      o.radius + trunkR - segmentDistance(o.center, f.chest, f.neck),
      o.radius + headR - f.headCenter.distanceTo(o.center),
    );
  }
  headFrom(d, f.neck, f.qChest, quatYXZ(yawOf(f.forward.x, f.forward.z), 0, 0, _qLevel), _level);
  return Math.max(
    boxDepth(o, _level.headCenter, crown(d)),
    boxDepth(o, f.hips, trunkR),
    boxDepth(o, _w.lerpVectors(f.hips, f.spine, 0.5), trunkR),
    boxDepth(o, f.spine, trunkR),
    boxDepth(o, _w.lerpVectors(f.spine, f.chest, 0.5), trunkR),
    boxDepth(o, f.chest, trunkR),
    boxDepth(o, _w.lerpVectors(f.chest, f.neck, 0.5), trunkR),
    boxDepth(o, f.neck, trunkR),
  );
}

/** How deep box `o` reaches into the head of a body standing upright at (x, z) (≤ 0 when clear). */
export function standingHeadDepth(o: Box, x: number, z: number, d: Proportions): number {
  const y = d.eyeHeight - d.head.eye.y + d.headCenter.y;
  return boxDepth(o, _v.set(x, y, z), crown(d));
}

/** the head sphere's radius out to the crown */
const crown = (d: Proportions) => d.head.top.distanceTo(d.headCenter);

/** how far a ball (`p`, radius `r`) must move up or down, whichever is shorter, to clear box `o` (< 0: clear, beside it or by that much) */
function boxDepth(o: Box, p: Vector3, r: number): number {
  const out = hypot(Math.max(0, o.min.x - p.x, p.x - o.max.x), Math.max(0, o.min.z - p.z, p.z - o.max.z));
  if (out >= r) return r - out;
  return Math.min(p.y + r - o.min.y, o.max.y + r - p.y);
}

/**
 * The centre of mass of what the posture moves: head, abdomen, thorax and the pelvis with
 * the thighs' share (the arms move on their own, the shanks stay with the feet).
 */
export function trunkCentre(f: TrunkFrame, out: Vector3): Vector3 {
  return out
    .copy(f.headCenter)
    .multiplyScalar(MASS.head)
    .addScaledVector(f.spine, MASS.spine)
    .addScaledVector(f.chest, MASS.chest)
    .addScaledVector(f.hips, MASS.pelvis)
    .divideScalar(TRUNK_MASS);
}

/** Standing upright at (x, z) facing `yaw`, pelvis dropped by `crouch`. */
export function resetPosture(p: Float64Array, x: number, z: number, yaw: number, crouch: number) {
  p.fill(0);
  p[P.X] = x;
  p[P.Z] = z;
  p[P.YAW] = yaw;
  p[P.DROP] = crouch;
}

/**
 * How a recoil moves the whole body's centre of mass (m/s, into `out`): the trunk turning
 * at `pitchRate` about the hips (+ = forward) and at `rollRate` about the chest (+ = raises
 * the left side), the mass above swinging with it.
 */
export function recoilVelocity(f: TrunkFrame, pitchRate: number, rollRate: number, out: Vector3): Vector3 {
  out.set(0, 0, 0);
  swing(out, f.left, pitchRate, f.hips, f.spine, MASS.spine);
  swing(out, f.left, pitchRate, f.hips, f.chest, MASS.chest);
  swing(out, f.left, pitchRate, f.hips, f.headCenter, MASS.head);
  return swing(out, f.forward, rollRate, f.chest, f.headCenter, MASS.head);
}

/** adds `mass` × the velocity of `point` turning at `rate` about `axis` through `pivot` */
function swing(out: Vector3, axis: Vector3, rate: number, pivot: Vector3, point: Vector3, mass: number): Vector3 {
  _v.subVectors(point, pivot);
  return out.addScaledVector(_w.crossVectors(axis, _v), rate * mass);
}
