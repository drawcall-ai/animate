import type { ReadonlyPose } from '../../kernel/pose';
import { Vector3 } from 'three';
import { INDEX, type ChildBone, type Side } from './bones';
import type { Proportions } from './proportions';

/** Points on the body that are not bone origins (OpenPose BODY_25 needs them); each is a node of the model, named so. */
type LandmarkName =
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
interface BonePoint {
  bone: number;
  at: Vector3;
}

/** A landmark: a point fixed in a bone's frame (VRM normalized). */
interface Landmark {
  bone: ChildBone;
  at: Vector3;
}

const mirror = (v: Vector3) => new Vector3(-v.x, v.y, v.z);

/** The landmarks of a body (the right side mirrors the left's x). */
function landmarksOf(proportions: Proportions): Record<LandmarkName, Landmark> {
  const { head: head, sole } = proportions;
  return {
    nose: { bone: 'head', at: head.nose.clone() },
    headTop: { bone: 'head', at: head.top.clone() },
    leftEye: { bone: 'head', at: head.eye.clone() },
    rightEye: { bone: 'head', at: mirror(head.eye) },
    leftEar: { bone: 'head', at: head.ear.clone() },
    rightEar: { bone: 'head', at: mirror(head.ear) },
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
export function palmOf(proportions: Proportions, side: Side): Vector3 {
  return proportions.offsets[`${side}Hand`].clone().setLength(PALM * proportions.height);
}

type PointName = LandmarkName | 'eyes' | 'leftWrist' | 'rightWrist' | 'leftPalm' | 'rightPalm';

/** The body's named points as the skeleton's: the landmarks, the eye midpoint, the wrists and the palms. */
export function pointsOf(proportions: Proportions): Record<PointName, BonePoint> {
  const l = landmarksOf(proportions);
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
    eyes: on('head', proportions.eyes.clone()),
    leftWrist: on('leftHand', new Vector3()),
    rightWrist: on('rightHand', new Vector3()),
    leftPalm: on('leftHand', palmOf(proportions, 'left')),
    rightPalm: on('rightHand', palmOf(proportions, 'right')),
  };
}

/** The three support points of one sole of a person of proportions `p`, in world space. */
export function solePoints(proportions: Proportions, pose: ReadonlyPose, side: Side): Vector3[] {
  let points = soles.get(proportions);
  if (!points) soles.set(proportions, (points = pointsOf(proportions)));
  const named = points;
  return (['Heel', 'BigToe', 'SmallToe'] as const).map((name) => {
    const point = named[`${side}${name}`];
    return pose.point(point.bone, point.at, new Vector3());
  });
}

/** each person's points, by their proportions (read once) */
const soles = new WeakMap<Proportions, Record<PointName, BonePoint>>();
