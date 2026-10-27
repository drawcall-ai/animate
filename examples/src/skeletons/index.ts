// The skeletons the examples' bodies stand on, as an app writes them for its meshes (@drawcall/rig's SkeletonBone[]: each joint where it
// is in model space, +Y up, facing +Z, the body's left +X; `as const` keeps the bone names). The soldier, the horse, the dog and the lion
// are measured on the meshes in public/models; the default person and the outlier have no mesh and are drawn as their bones.
import type { SkeletonBone } from '@drawcall/rig';
import { PERSON } from '../../../packages/animate/skills/animate/references/person';

export { PERSON } from '../../../packages/animate/skills/animate/references/person';

/** The soldier (public/models/soldier.glb): 1.8 m to its crown, its arms short for its height (0.46 m against the default's 0.60 m). */
export const SOLDIER = [
  { name: 'hips', position: [0, 0.96, 0] },
  { name: 'spine', parent: 'hips', position: [0, 1.06, -0.01] },
  { name: 'chest', parent: 'spine', position: [0, 1.25, -0.01] },
  { name: 'neck', parent: 'chest', position: [0, 1.5, 0] },
  { name: 'head', parent: 'neck', position: [0, 1.59, 0] },
  { name: 'head_end', parent: 'head', position: [0, 1.8, 0] },
  { name: 'leftShoulder', parent: 'chest', position: [0.04, 1.45, -0.01] },
  { name: 'leftUpperArm', parent: 'leftShoulder', position: [0.18, 1.4263, -0.0023] },
  { name: 'leftLowerArm', parent: 'leftUpperArm', position: [0.41, 1.391, -0.0491] },
  { name: 'leftHand', parent: 'leftLowerArm', position: [0.62, 1.3618, 0.0286] },
  { name: 'leftHand_end', parent: 'leftHand', position: [0.74, 1.34, 0.0286] },
  { name: 'rightShoulder', parent: 'chest', position: [-0.04, 1.45, -0.01] },
  { name: 'rightUpperArm', parent: 'rightShoulder', position: [-0.18, 1.4278, -0.0226] },
  { name: 'rightLowerArm', parent: 'rightUpperArm', position: [-0.41, 1.3913, -0.0522] },
  { name: 'rightHand', parent: 'rightLowerArm', position: [-0.62, 1.3623, 0.0289] },
  { name: 'rightHand_end', parent: 'rightHand', position: [-0.74, 1.34, 0.0289] },
  { name: 'leftUpperLeg', parent: 'hips', position: [0.09, 0.92, 0] },
  { name: 'leftLowerLeg', parent: 'leftUpperLeg', position: [0.147, 0.51, 0.0056] },
  { name: 'leftFoot', parent: 'leftLowerLeg', position: [0.1824, 0.1, -0.0291] },
  { name: 'leftToes', parent: 'leftFoot', position: [0.1824, 0.035, 0.1] },
  { name: 'leftToes_end', parent: 'leftToes', position: [0.1824, 0.025, 0.17] },
  { name: 'rightUpperLeg', parent: 'hips', position: [-0.09, 0.92, 0] },
  { name: 'rightLowerLeg', parent: 'rightUpperLeg', position: [-0.1473, 0.51, 0.0096] },
  { name: 'rightFoot', parent: 'rightLowerLeg', position: [-0.1819, 0.1, -0.0241] },
  { name: 'rightToes', parent: 'rightFoot', position: [-0.1819, 0.035, 0.1] },
  { name: 'rightToes_end', parent: 'rightToes', position: [-0.1819, 0.025, 0.17] },
] as const satisfies readonly SkeletonBone[];

/** An outlier: the default person's 1.75 m with legs 0.7×, trunk 1.3× and arms 1.3× as long. */
export const OUTLIER = [
  { name: 'hips', position: [0, 0.6697, 0] },
  { name: 'spine', parent: 'hips', position: [0, 0.829, -0.0088] },
  { name: 'chest', parent: 'spine', position: [0, 1.0565, -0.0088] },
  { name: 'neck', parent: 'chest', position: [0, 1.3249, -0.0018] },
  { name: 'head', parent: 'neck', position: [0, 1.4614, -0.0018] },
  { name: 'head_end', parent: 'head', position: [0, 1.75, -0.0018] },
  { name: 'leftShoulder', parent: 'chest', position: [0.035, 1.2976, -0.0158] },
  { name: 'leftUpperArm', parent: 'leftShoulder', position: [0.175, 1.2976, -0.0158] },
  { name: 'leftLowerArm', parent: 'leftUpperArm', position: [0.5982, 1.2976, -0.0158] },
  { name: 'leftHand', parent: 'leftLowerArm', position: [0.9303, 1.2976, -0.0158] },
  { name: 'rightShoulder', parent: 'chest', position: [-0.035, 1.2976, -0.0158] },
  { name: 'rightUpperArm', parent: 'rightShoulder', position: [-0.175, 1.2976, -0.0158] },
  { name: 'rightLowerArm', parent: 'rightUpperArm', position: [-0.5982, 1.2976, -0.0158] },
  { name: 'rightHand', parent: 'rightLowerArm', position: [-0.9303, 1.2976, -0.0158] },
  { name: 'leftUpperLeg', parent: 'hips', position: [0.0875, 0.6697, 0] },
  { name: 'leftLowerLeg', parent: 'leftUpperLeg', position: [0.0875, 0.3696, 0] },
  { name: 'leftFoot', parent: 'leftLowerLeg', position: [0.0875, 0.0682, 0] },
  { name: 'leftToes', parent: 'leftFoot', position: [0.0875, 0, 0.14] },
  { name: 'rightUpperLeg', parent: 'hips', position: [-0.0875, 0.6697, 0] },
  { name: 'rightLowerLeg', parent: 'rightUpperLeg', position: [-0.0875, 0.3696, 0] },
  { name: 'rightFoot', parent: 'rightLowerLeg', position: [-0.0875, 0.0682, 0] },
  { name: 'rightToes', parent: 'rightFoot', position: [-0.0875, 0, 0.14] },
] as const satisfies readonly SkeletonBone[];

/** A person's skeleton: one of the three above, or one of them scaled. */
export type PersonSkeleton = typeof PERSON | typeof SOLDIER | typeof OUTLIER;

/** `skeleton` with every joint `factor` times as far from the floor's origin: the same body, taller or shorter */
export function scaled<S extends readonly SkeletonBone[]>(skeleton: S, factor: number): S {
  return skeleton.map((bone) => ({ ...bone, position: [bone.position[0] * factor, bone.position[1] * factor, bone.position[2] * factor] })) as unknown as S;
}

export { HORSE } from '../../../packages/animate/skills/animate/references/horse';

export { DOG } from '../../../packages/animate/skills/animate/references/dog';

export { LION } from '../../../packages/animate/skills/animate/references/lion';
