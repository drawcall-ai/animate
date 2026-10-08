import { Vector3 } from 'three';

/**
 * The VRM 1.0 humanoid bones the body drives, parents before children.
 * Normalized convention: +Y up, the character faces +Z, its left is +X, and
 * every bone's rest rotation (T-pose) is identity.
 *
 * Left out on purpose: upperChest (no separate degree of freedom; a model
 * that has one keeps it at identity), jaw/eyes (lookAt is the VRM's job),
 * fingers (no input drives them).
 */
export const BONES = [
  'hips',
  'spine',
  'chest',
  'neck',
  'head',
  'leftShoulder',
  'leftUpperArm',
  'leftLowerArm',
  'leftHand',
  'rightShoulder',
  'rightUpperArm',
  'rightLowerArm',
  'rightHand',
  'leftUpperLeg',
  'leftLowerLeg',
  'leftFoot',
  'leftToes',
  'rightUpperLeg',
  'rightLowerLeg',
  'rightFoot',
  'rightToes',
] as const;

export type BoneName = (typeof BONES)[number];
/** every bone but the root */
export type ChildBone = Exclude<BoneName, 'hips'>;

export const SIDES = ['left', 'right'] as const;

/** Each side's bone names, [left, right]. */
export const SIDE_BONES = [
  {
    shoulder: 'leftShoulder',
    upperArm: 'leftUpperArm',
    lowerArm: 'leftLowerArm',
    hand: 'leftHand',
    upperLeg: 'leftUpperLeg',
    lowerLeg: 'leftLowerLeg',
    foot: 'leftFoot',
    toes: 'leftToes',
  },
  {
    shoulder: 'rightShoulder',
    upperArm: 'rightUpperArm',
    lowerArm: 'rightLowerArm',
    hand: 'rightHand',
    upperLeg: 'rightUpperLeg',
    lowerLeg: 'rightLowerLeg',
    foot: 'rightFoot',
    toes: 'rightToes',
  },
] as const;

/** One fresh value per bone. */
export function perBone<V>(make: (b: BoneName) => V): Record<BoneName, V> {
  return {
    hips: make('hips'),
    spine: make('spine'),
    chest: make('chest'),
    neck: make('neck'),
    head: make('head'),
    leftShoulder: make('leftShoulder'),
    leftUpperArm: make('leftUpperArm'),
    leftLowerArm: make('leftLowerArm'),
    leftHand: make('leftHand'),
    rightShoulder: make('rightShoulder'),
    rightUpperArm: make('rightUpperArm'),
    rightLowerArm: make('rightLowerArm'),
    rightHand: make('rightHand'),
    leftUpperLeg: make('leftUpperLeg'),
    leftLowerLeg: make('leftLowerLeg'),
    leftFoot: make('leftFoot'),
    leftToes: make('leftToes'),
    rightUpperLeg: make('rightUpperLeg'),
    rightLowerLeg: make('rightLowerLeg'),
    rightFoot: make('rightFoot'),
    rightToes: make('rightToes'),
  };
}

export const CHILD_BONES = BONES.filter((b): b is ChildBone => b !== 'hips');

export const PARENT: Record<ChildBone, BoneName> = {
  spine: 'hips',
  chest: 'spine',
  neck: 'chest',
  head: 'neck',
  leftShoulder: 'chest',
  leftUpperArm: 'leftShoulder',
  leftLowerArm: 'leftUpperArm',
  leftHand: 'leftLowerArm',
  rightShoulder: 'chest',
  rightUpperArm: 'rightShoulder',
  rightLowerArm: 'rightUpperArm',
  rightHand: 'rightLowerArm',
  leftUpperLeg: 'hips',
  leftLowerLeg: 'leftUpperLeg',
  leftFoot: 'leftLowerLeg',
  leftToes: 'leftFoot',
  rightUpperLeg: 'hips',
  rightLowerLeg: 'rightUpperLeg',
  rightFoot: 'rightLowerLeg',
  rightToes: 'rightFoot',
};

const Y = new Vector3(0, 1, 0);
const NX = new Vector3(-1, 0, 0);
const NY = new Vector3(0, -1, 0);

export type LimbBone =
  | 'leftUpperArm'
  | 'leftLowerArm'
  | 'rightUpperArm'
  | 'rightLowerArm'
  | 'leftUpperLeg'
  | 'leftLowerLeg'
  | 'rightUpperLeg'
  | 'rightLowerLeg';

/**
 * T-pose hinge axis of the two-bone limbs: `dir × bend`, where `bend` is the
 * side the middle joint moves to when the limb flexes (elbow back, knee forward).
 */
export const REST_HINGE: Record<LimbBone, Vector3> = {
  leftUpperArm: Y,
  leftLowerArm: Y,
  rightUpperArm: NY,
  rightLowerArm: NY,
  leftUpperLeg: NX,
  leftLowerLeg: NX,
  rightUpperLeg: NX,
  rightLowerLeg: NX,
};

/**
 * A body's normalized rest pose: where each bone's origin sits relative to its
 * parent's origin with every rotation at identity (T-pose), in metres.
 */
export interface Rest {
  /** hips origin above the ground point between the feet */
  hips: Vector3;
  offsets: Record<ChildBone, Vector3>;
}

export function createRest(): Rest {
  const { hips, ...offsets } = perBone(() => new Vector3());
  return { hips, offsets };
}
