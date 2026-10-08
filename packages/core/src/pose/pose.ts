import { Quaternion, Vector3 } from 'three';
import { framePoint } from '../math';
import type { Proportions } from '../proportions';
import { SIDE_BONES, perBone, type BoneName, type ChildBone } from './bones';
import type { Frames } from './frames';
import { createRotations, fromFrames, type Rotations } from './rotations';

/** Points on the body that are not bone origins (OpenPose BODY_25 needs them). */
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
export type JointName = BoneName | LandmarkName;
/** world positions of the bone origins and landmarks */
export type Joints = Record<JointName, Vector3>;

/** A landmark: a point fixed in a bone's frame (VRM normalized). */
export interface Landmark {
  name: LandmarkName;
  bone: ChildBone;
  at: Vector3;
}

/** The landmarks of a body (the right side mirrors the left's x). */
export function landmarksOf(p: Proportions): Landmark[] {
  const { head: h, sole } = p;
  const right = (v: Vector3) => new Vector3(-v.x, v.y, v.z);
  return [
    { name: 'nose', bone: 'head', at: h.nose.clone() },
    { name: 'headTop', bone: 'head', at: h.top.clone() },
    { name: 'leftEye', bone: 'head', at: h.eye.clone() },
    { name: 'rightEye', bone: 'head', at: right(h.eye) },
    { name: 'leftEar', bone: 'head', at: h.ear.clone() },
    { name: 'rightEar', bone: 'head', at: right(h.ear) },
    { name: 'leftHeel', bone: 'leftFoot', at: sole.heel.clone() },
    { name: 'rightHeel', bone: 'rightFoot', at: right(sole.heel) },
    { name: 'leftBigToe', bone: 'leftToes', at: sole.bigToe.clone() },
    { name: 'rightBigToe', bone: 'rightToes', at: right(sole.bigToe) },
    { name: 'leftSmallToe', bone: 'leftToes', at: sole.smallToe.clone() },
    { name: 'rightSmallToe', bone: 'rightToes', at: right(sole.smallToe) },
  ];
}

/** The body's state after a tick. */
export interface Pose {
  /** the ground point the body stands over and its facing (yaw about +Y; 0 faces +Z) */
  root: { position: Vector3; quaternion: Quaternion; yaw: number };
  /** parent-relative bone rotations, VRM normalized (T-pose rest = identity); the hips' parent is the world */
  rotations: Rotations;
  /** world positions of the bone origins and landmarks */
  joints: Joints;
}

export function createPose(): Pose {
  const v = () => new Vector3();
  const joints: Joints = {
    ...perBone(v),
    nose: v(),
    headTop: v(),
    leftEye: v(),
    rightEye: v(),
    leftEar: v(),
    rightEar: v(),
    leftHeel: v(),
    rightHeel: v(),
    leftBigToe: v(),
    rightBigToe: v(),
    leftSmallToe: v(),
    rightSmallToe: v(),
  };
  return { root: { position: new Vector3(), quaternion: new Quaternion(), yaw: 0 }, rotations: createRotations(), joints };
}

const UP = new Vector3(0, 1, 0);
const _world = createRotations();

/** Moves the whole posed body by `by` (its root and every joint). */
export function movePose(pose: Pose, by: Vector3) {
  pose.root.position.add(by);
  for (const k in pose.joints) pose.joints[k as JointName].add(by);
}

/** Fills `pose` from the posed frames, standing over `root`. */
export function writePose(frames: Frames, p: Proportions, landmarks: readonly Landmark[], root: { x: number; y: number; z: number; yaw: number }, pose: Pose) {
  pose.root.position.set(root.x, root.y, root.z);
  pose.root.quaternion.setFromAxisAngle(UP, root.yaw);
  pose.root.yaw = root.yaw;
  fromFrames(frames, p, _world, pose.rotations);
  const j = pose.joints;
  const { trunk } = frames;
  j.hips.copy(trunk.hips);
  j.spine.copy(trunk.spine);
  j.chest.copy(trunk.chest);
  j.neck.copy(trunk.neck);
  j.head.copy(frames.head.head);
  for (let s = 0; s < 2; s++) {
    const b = SIDE_BONES[s];
    const side = frames.sides[s];
    j[b.shoulder].copy(side.clavicle);
    j[b.upperArm].copy(side.arm.root);
    j[b.lowerArm].copy(side.arm.mid);
    j[b.hand].copy(side.arm.end);
    j[b.upperLeg].copy(side.leg.root);
    j[b.lowerLeg].copy(side.leg.mid);
    j[b.foot].copy(side.leg.end);
    framePoint(j[b.toes], side.leg.end, side.foot, p.offsets[b.toes]);
  }
  for (const l of landmarks) framePoint(j[l.name], j[l.bone], _world[l.bone], l.at);
}
