import { Vector3 } from 'three';
import { INDEX, type ChildBone, type Side } from './bones';
import type { Proportions } from './proportions';

/** Points on the body that are not bone origins (OpenPose BODY_25 needs them); each is a node of the model, named so. */
export type LandmarkName =
  | 'nose'
  | 'headTop'
  | 'leftEye'
  | 'rightEye'
  | 'leftEar'
  | 'rightEar'
  | 'leftHeel'
  | 'rightHeel'
  | 'leftBigToe'
  | 'rightBigToe'
  | 'leftSmallToe'
  | 'rightSmallToe';

/** A point fixed in a bone's frame (a heel, the eye midpoint, a palm), the bone by index. */
export interface BonePoint {
  bone: number;
  at: Vector3;
}

/** A landmark: a point fixed in a bone's frame (VRM normalized). */
export interface Landmark {
  bone: ChildBone;
  at: Vector3;
}

const mirror = (v: Vector3) => new Vector3(-v.x, v.y, v.z);

// Copied from the old core (a801be4:packages/core/src/pose/pose.ts: landmarksOf), keyed by name.
/** The landmarks of a body (the right side mirrors the left's x). */
export function landmarksOf(p: Proportions): Record<LandmarkName, Landmark> {
  const { head: h, sole } = p;
  return {
    nose: { bone: 'head', at: h.nose.clone() },
    headTop: { bone: 'head', at: h.top.clone() },
    leftEye: { bone: 'head', at: h.eye.clone() },
    rightEye: { bone: 'head', at: mirror(h.eye) },
    leftEar: { bone: 'head', at: h.ear.clone() },
    rightEar: { bone: 'head', at: mirror(h.ear) },
    leftHeel: { bone: 'leftFoot', at: sole.heel.clone() },
    rightHeel: { bone: 'rightFoot', at: mirror(sole.heel) },
    leftBigToe: { bone: 'leftToes', at: sole.bigToe.clone() },
    rightBigToe: { bone: 'rightToes', at: mirror(sole.bigToe) },
    leftSmallToe: { bone: 'leftToes', at: sole.smallToe.clone() },
    rightSmallToe: { bone: 'rightToes', at: mirror(sole.smallToe) },
  };
}

/**
 * the palm's centre beyond the wrist, along the forearm, as a share of the standing height: ~0.4
 * of the hand's length (Drillis & Contini: 0.108), where Dempster puts the hand's centre of mass
 */
const PALM = 0.043;

/** the palm's centre in the hand bone's frame */
export function palmOf(p: Proportions, side: Side): Vector3 {
  return p.offsets[`${side}Hand`].clone().setLength(PALM * p.height);
}

export type PointName = LandmarkName | 'eyes' | 'leftWrist' | 'rightWrist' | 'leftPalm' | 'rightPalm';

/** The body's named points as the skeleton's: the landmarks, the eye midpoint, the wrists and the palms. */
export function pointsOf(p: Proportions): Record<PointName, BonePoint> {
  const l = landmarksOf(p);
  const on = (bone: ChildBone, at: Vector3): BonePoint => ({ bone: INDEX[bone], at });
  const at = (m: Landmark) => on(m.bone, m.at);
  return {
    nose: at(l.nose),
    headTop: at(l.headTop),
    leftEye: at(l.leftEye),
    rightEye: at(l.rightEye),
    leftEar: at(l.leftEar),
    rightEar: at(l.rightEar),
    leftHeel: at(l.leftHeel),
    rightHeel: at(l.rightHeel),
    leftBigToe: at(l.leftBigToe),
    rightBigToe: at(l.rightBigToe),
    leftSmallToe: at(l.leftSmallToe),
    rightSmallToe: at(l.rightSmallToe),
    eyes: on('head', p.eyes.clone()),
    leftWrist: on('leftHand', new Vector3()),
    rightWrist: on('rightHand', new Vector3()),
    leftPalm: on('leftHand', palmOf(p, 'left')),
    rightPalm: on('rightHand', palmOf(p, 'right')),
  };
}
