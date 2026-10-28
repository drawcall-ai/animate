import { Vector3 } from 'three';

/** VRM 1.0 humanoid bone names in parent-first order. Rest convention: +Y up, +Z forward, left +X, identity T-pose rotations.
 * upperChest has no separate degree of freedom and stays at identity; VRM lookAt handles jaw/eyes, and nothing drives fingers. */
export const BONES = [
  'hips', 'spine', 'chest', 'neck', 'head',
  'leftShoulder', 'leftUpperArm', 'leftLowerArm', 'leftHand', 'rightShoulder', 'rightUpperArm', 'rightLowerArm', 'rightHand',
  'leftUpperLeg', 'leftLowerLeg', 'leftFoot', 'leftToes', 'rightUpperLeg', 'rightLowerLeg', 'rightFoot', 'rightToes',
] as const;

export type BoneName = (typeof BONES)[number];
/** every bone but the root */
export type ChildBone = Exclude<BoneName, 'hips'>;

export const SIDES = ['left', 'right'] as const;
export type Side = (typeof SIDES)[number];

/** `hand` as a person's side: a person's hands are `left` and `right` (a hand of another name is a misuse, said at once) */
export function sideOf(hand: string): Side {
  const side = SIDES.find((s) => s === hand);
  if (!side) throw new Error(`a person's hands are left and right, not "${hand}"`);
  return side;
}

/** One fresh value per bone. */
export function perBone<V>(make: (bone: BoneName) => V): Record<BoneName, V> {
  const values: Partial<Record<BoneName, V>> = {};
  for (const bone of BONES) values[bone] = make(bone);
  if (!complete(values)) throw new Error('a bone without a value');
  return values;
}

const complete = <V>(values: Partial<Record<BoneName, V>>): values is Record<BoneName, V> => BONES.every((bone) => bone in values);

/** each person's bone's index in the skeleton, by name */
export const INDEX = perBone((b) => BONES.indexOf(b));

export const CHILD_BONES = BONES.filter((b): b is ChildBone => b !== 'hips');

export const PARENT: Record<ChildBone, BoneName> = {
  spine: 'hips', chest: 'spine', neck: 'chest', head: 'neck',
  leftShoulder: 'chest', leftUpperArm: 'leftShoulder', leftLowerArm: 'leftUpperArm', leftHand: 'leftLowerArm',
  rightShoulder: 'chest', rightUpperArm: 'rightShoulder', rightLowerArm: 'rightUpperArm', rightHand: 'rightLowerArm',
  leftUpperLeg: 'hips', leftLowerLeg: 'leftUpperLeg', leftFoot: 'leftLowerLeg', leftToes: 'leftFoot',
  rightUpperLeg: 'hips', rightLowerLeg: 'rightUpperLeg', rightFoot: 'rightLowerLeg', rightToes: 'rightFoot',
};

/** Rest offsets in metres from each parent, at identity T-pose rotations. */
export interface Rest {
  /** hips origin above the ground point between the feet */
  hips: Vector3;
  offsets: Record<ChildBone, Vector3>;
}

export function createRest(): Rest {
  const { hips, ...offsets } = perBone(() => new Vector3());
  return { hips, offsets };
}
