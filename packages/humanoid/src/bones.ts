// Copied from @prohuman/core (packages/core/src/pose/bones.ts), with the bones' indices added.
import { Vector3 } from 'three';

/**
 * The VRM 1.0 humanoid bones the body drives, parents before children: the skeleton's bones in
 * this order. Normalized convention: +Y up, the character faces +Z, its left is +X, and every
 * bone's rest rotation (T-pose) is identity.
 *
 * Left out on purpose: upperChest (no separate degree of freedom; a model that has one keeps it
 * at identity), jaw/eyes (lookAt is the VRM's job), fingers (nothing drives them).
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
export type Side = (typeof SIDES)[number];

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

/** each bone's index in BONES: its index in the skeleton */
export const INDEX = perBone((b) => BONES.indexOf(b));

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

/**
 * A body's normalized rest pose: where each bone's origin sits relative to its parent's origin
 * with every rotation at identity (T-pose), in metres.
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
