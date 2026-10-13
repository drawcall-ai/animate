import { Matrix4, Quaternion, Vector3 } from 'three';
import type { Ctx, Tier } from '@prohuman/body';
import { INDEX, type Side } from '../bones';
import type { Humanoid } from '../humanoid';
import { clamp, forwardOf } from '../math';
import type { Proportions } from '../proportions';

const UP = new Vector3(0, 1, 0);
const DOWN = new Vector3(0, -1, 0);
const X = new Vector3(1, 0, 0);
const ORIGIN = new Vector3();
const _d = new Vector3();
const _bend = new Vector3();
const _knee = new Vector3();
const _leg = new Vector3();
const _out = new Vector3();
const _v = new Vector3();
const _pole = new Vector3();
const _thigh = new Vector3();
const _shank = new Vector3();
const _hinge = new Vector3();
const _up = new Vector3();
const _z = new Vector3();
const _arc = new Quaternion();
const _m = new Matrix4();
const _rThigh = new Quaternion();
const _rShank = new Quaternion();
const _q = new Quaternion();

// Copied from @prohuman/core (packages/core/src/limbs/legs.ts: kneePole), without the knee turned out.
/**
 * Where a leg's knee bends (into `out`): over the toes (the foot's heading `yaw` blended with the
 * body's `facing`); a leg raised forward bends with the knee up, one raised out sideways carries
 * it along, the knee at the thigh's front.
 */
export function kneePole(side: Side, yaw: number, facing: number, hip: Vector3, ankle: Vector3, out: Vector3): Vector3 {
  forwardOf(yaw, out).add(forwardOf(facing, _v)).normalize();
  const leg = _leg.subVectors(ankle, hip).normalize();
  const outward = _out.crossVectors(UP, out).multiplyScalar(side === 'left' ? 1 : -1);
  const abducted = Math.max(0, leg.dot(outward));
  out.y = 0.15 + 2.5 * Math.max(0, leg.dot(out) + 0.2);
  return out.applyQuaternion(_arc.setFromUnitVectors(DOWN, _v.set(0, -Math.sqrt(1 - abducted * abducted), 0).addScaledVector(outward, abducted)));
}

// Adapted from @prohuman/core (packages/core/src/limbs/twoBone.ts: solveTwoBone).
/**
 * The middle joint of a two-bone limb (`len1`, `len2`) from `root` toward `end`, bent toward
 * `pole` (law of cosines; a little short of straight), into `out`; the limb's direction is left
 * in `_d`, the way it bends (across it) in `bend`.
 */
export function middleJoint(root: Vector3, end: Vector3, len1: number, len2: number, pole: Vector3, out: Vector3, bend = new Vector3()): Vector3 {
  _d.subVectors(end, root);
  const raw = _d.length();
  const dist = clamp(raw, Math.abs(len1 - len2) + 1e-4, (len1 + len2) * 0.9995);
  if (raw < 1e-6) _d.copy(DOWN);
  else _d.divideScalar(raw);
  const cos = clamp((len1 * len1 + dist * dist - len2 * len2) / (2 * len1 * dist), -1, 1);
  bend.copy(pole).addScaledVector(_d, -pole.dot(_d));
  if (bend.lengthSq() < 1e-10) bend.set(0, 0, 1).addScaledVector(_d, -_d.z);
  bend.normalize();
  return out
    .copy(root)
    .addScaledVector(_d, cos * len1)
    .addScaledVector(bend, Math.sqrt(1 - cos * cos) * len1);
}

/** A leg's joints, each in its parent's frame. */
export interface LegPose {
  upper: Quaternion;
  lower: Quaternion;
  foot: Quaternion;
  toes: Quaternion;
}

export const createLegPose = (): LegPose => ({ upper: new Quaternion(), lower: new Quaternion(), foot: new Quaternion(), toes: new Quaternion() });

/**
 * Leg `side` posed from its hip joint `hip` (the pelvis turned `pelvis`) down to its ankle at
 * `ankle`, the foot turned `foot` and the toes `toes` (world), the knee bent toward the toes (law
 * of cosines, a little short of straight; adapted from @prohuman/core's solveTwoBone), into `out`.
 */
export function legPose(p: Proportions, side: Side, pelvis: Quaternion, hip: Vector3, ankle: Vector3, foot: Quaternion, toes: Quaternion, facing: number, out: LegPose): LegPose {
  const fwd = _z.set(0, 0, 1).applyQuaternion(foot);
  const pole = kneePole(side, Math.atan2(fwd.x, fwd.z), facing, hip, ankle, _pole);
  const knee = middleJoint(hip, ankle, p.thigh, p.shin, pole, _knee, _bend);
  const dist = Math.min(hip.distanceTo(ankle), (p.thigh + p.shin) * 0.9995);
  const thigh = _thigh.subVectors(knee, hip).normalize();
  const shank = _shank.copy(hip).addScaledVector(_d, dist).sub(knee).normalize();
  // the knee's hinge across the leg's plane: the thigh's x
  const hinge = _hinge.crossVectors(_bend, _d).normalize();
  _up.copy(thigh).negate();
  _rThigh.setFromRotationMatrix(_m.makeBasis(hinge, _up, _z.crossVectors(hinge, _up)));
  const flex = Math.acos(clamp(thigh.dot(shank), -1, 1));
  _rShank.copy(_rThigh).multiply(_q.setFromAxisAngle(X, flex));
  out.upper.copy(pelvis).invert().multiply(_rThigh);
  out.lower.setFromAxisAngle(X, flex);
  out.foot.copy(_rShank).invert().multiply(foot);
  out.toes.copy(foot).invert().multiply(toes);
  return out;
}

/** How a leg's pose is pulled. */
export interface LegGoal {
  weight: number;
  tier?: Tier;
  owner: string;
  stiffness?: number;
}

const _pose = createLegPose();

/**
 * Proposes leg `side` posed as `legPose` has it: targets on the leg's own joints, which pull
 * nothing else: what the foot's contact holds, they put in place before it has to.
 */
export function poseLeg<W>(ctx: Ctx<W>, h: Humanoid<W>, side: Side, pelvis: Quaternion, hip: Vector3, ankle: Vector3, foot: Quaternion, toes: Quaternion, facing: number, goal: LegGoal) {
  const pose = legPose(h.proportions, side, pelvis, hip, ankle, foot, toes, facing, _pose);
  const local = (bone: 'UpperLeg' | 'LowerLeg' | 'Foot' | 'Toes', value: Quaternion) => ctx.propose.target({ kind: 'local', point: { bone: INDEX[`${side}${bone}`], at: ORIGIN }, value, ...goal });
  local('UpperLeg', pose.upper);
  local('LowerLeg', pose.lower);
  local('Foot', pose.foot);
  local('Toes', pose.toes);
}

/**
 * `ankle` drawn into the leg's reach (`reach` m) from the hip joint `hip`: softly, from `soft` of
 * it on (no kink for the leg to follow)
 */
export function withinReach(hip: Readonly<Vector3>, ankle: Vector3, reach: number, soft = 0.97): Vector3 {
  const d = _d.subVectors(ankle, hip);
  const l = d.length();
  const from = soft * reach;
  if (l <= from) return ankle;
  const span = reach - from;
  return ankle.copy(hip).addScaledVector(d, (from + span * Math.tanh((l - from) / span)) / l);
}

/** where the hip joint of leg `side` will be next frame, as it moves now */
export function nextHip<W>(ctx: Ctx<W>, side: Side, out: Vector3): Vector3 {
  const bone = INDEX[`${side}UpperLeg`];
  return out.copy(ctx.body.positions[bone]).addScaledVector(ctx.body.velocities[bone], ctx.dt);
}
