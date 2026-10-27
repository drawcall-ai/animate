// The skeletons the examples' bodies stand on, as an app writes them for its meshes (@drawcall/rig's SkeletonBone[]: each joint where it
// is in model space, +Y up, facing +Z, the body's left +X; `as const` keeps the bone names). The soldier, the horse, the dog and the lion
// are measured on the meshes in public/models; the default person and the outlier have no mesh and are drawn as their bones.
import type { SkeletonBone } from '@drawcall/rig';

/** A person of the default proportions, 1.75 m tall (Drillis & Contini's shares of the height), standing in a T-pose. */
export const PERSON = [
  { name: 'hips', position: [0, 0.9275, 0] },
  { name: 'spine', parent: 'hips', position: [0, 1.05, -0.00875] },
  { name: 'chest', parent: 'spine', position: [0, 1.225, -0.00875] },
  { name: 'neck', parent: 'chest', position: [0, 1.4315, -0.00175] },
  { name: 'head', parent: 'neck', position: [0, 1.5365, -0.00175] },
  { name: 'head_end', parent: 'head', position: [0, 1.75, -0.00175] },
  { name: 'leftShoulder', parent: 'chest', position: [0.035, 1.4105, -0.01575] },
  { name: 'leftUpperArm', parent: 'leftShoulder', position: [0.175, 1.4105, -0.01575] },
  { name: 'leftLowerArm', parent: 'leftUpperArm', position: [0.5005, 1.4105, -0.01575] },
  { name: 'leftHand', parent: 'leftLowerArm', position: [0.756, 1.4105, -0.01575] },
  { name: 'leftHand_end', parent: 'leftHand', position: [0.945, 1.4105, -0.01575] },
  { name: 'rightShoulder', parent: 'chest', position: [-0.035, 1.4105, -0.01575] },
  { name: 'rightUpperArm', parent: 'rightShoulder', position: [-0.175, 1.4105, -0.01575] },
  { name: 'rightLowerArm', parent: 'rightUpperArm', position: [-0.5005, 1.4105, -0.01575] },
  { name: 'rightHand', parent: 'rightLowerArm', position: [-0.756, 1.4105, -0.01575] },
  { name: 'rightHand_end', parent: 'rightHand', position: [-0.945, 1.4105, -0.01575] },
  { name: 'leftUpperLeg', parent: 'hips', position: [0.0875, 0.9275, 0] },
  { name: 'leftLowerLeg', parent: 'leftUpperLeg', position: [0.0875, 0.49875, 0] },
  { name: 'leftFoot', parent: 'leftLowerLeg', position: [0.0875, 0.06825, 0] },
  { name: 'leftToes', parent: 'leftFoot', position: [0.0875, 0, 0.14] },
  { name: 'leftToes_end', parent: 'leftToes', position: [0.0875, 0, 0.1925] },
  { name: 'rightUpperLeg', parent: 'hips', position: [-0.0875, 0.9275, 0] },
  { name: 'rightLowerLeg', parent: 'rightUpperLeg', position: [-0.0875, 0.49875, 0] },
  { name: 'rightFoot', parent: 'rightLowerLeg', position: [-0.0875, 0.06825, 0] },
  { name: 'rightToes', parent: 'rightFoot', position: [-0.0875, 0, 0.14] },
  { name: 'rightToes_end', parent: 'rightToes', position: [-0.0875, 0, 0.1925] },
] as const satisfies readonly SkeletonBone[];

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

/**
 * A warmblood of 1.60 m at the withers (16 hands), standing square (public/models/horse.glb): the trunk on the spine under the saddle,
 * the back's pivot at the hip axis, a scapula above each foreleg, ears and a tail.
 */
export const HORSE = [
  { name: 'trunk', position: [0, 1.4, 0] },
  { name: 'back', parent: 'trunk', position: [0, 1.24, -0.64] },
  { name: 'pelvis', parent: 'back', position: [0, 1.39, -0.57] },
  { name: 'neck', parent: 'trunk', position: [0, 1.34, 0.72] },
  { name: 'head', parent: 'neck', position: [0, 1.75, 1.2] },
  { name: 'leftScapula', parent: 'trunk', position: [0.12, 1.44, 0.657] },
  { name: 'leftHumerus', parent: 'leftScapula', position: [0.17, 1.1, 0.857] },
  { name: 'leftForearm', parent: 'leftHumerus', position: [0.17, 0.889, 0.63] },
  { name: 'leftForeCannon', parent: 'leftForearm', position: [0.17, 0.47, 0.63] },
  { name: 'leftForePastern', parent: 'leftForeCannon', position: [0.17, 0.24, 0.63] },
  { name: 'leftForeHoof', parent: 'leftForePastern', position: [0.17, 0.097, 0.73] },
  { name: 'rightScapula', parent: 'trunk', position: [-0.12, 1.44, 0.657] },
  { name: 'rightHumerus', parent: 'rightScapula', position: [-0.17, 1.1, 0.857] },
  { name: 'rightForearm', parent: 'rightHumerus', position: [-0.17, 0.889, 0.63] },
  { name: 'rightForeCannon', parent: 'rightForearm', position: [-0.17, 0.47, 0.63] },
  { name: 'rightForePastern', parent: 'rightForeCannon', position: [-0.17, 0.24, 0.63] },
  { name: 'rightForeHoof', parent: 'rightForePastern', position: [-0.17, 0.097, 0.73] },
  { name: 'leftFemur', parent: 'pelvis', position: [0.15, 1.24, -0.64] },
  { name: 'leftGaskin', parent: 'leftFemur', position: [0.16, 0.852, -0.433] },
  { name: 'leftHindCannon', parent: 'leftGaskin', position: [0.15, 0.5, -0.71] },
  { name: 'leftHindPastern', parent: 'leftHindCannon', position: [0.15, 0.22, -0.71] },
  { name: 'leftHindHoof', parent: 'leftHindPastern', position: [0.15, 0.097, -0.624] },
  { name: 'rightFemur', parent: 'pelvis', position: [-0.15, 1.24, -0.64] },
  { name: 'rightGaskin', parent: 'rightFemur', position: [-0.16, 0.852, -0.433] },
  { name: 'rightHindCannon', parent: 'rightGaskin', position: [-0.15, 0.5, -0.71] },
  { name: 'rightHindPastern', parent: 'rightHindCannon', position: [-0.15, 0.22, -0.71] },
  { name: 'rightHindHoof', parent: 'rightHindPastern', position: [-0.15, 0.097, -0.624] },
  { name: 'leftEar', parent: 'head', position: [0.06, 1.82, 1.25] },
  { name: 'rightEar', parent: 'head', position: [-0.06, 1.82, 1.25] },
  { name: 'tail', parent: 'pelvis', position: [0, 1.43, -0.79] },
] as const satisfies readonly SkeletonBone[];

/**
 * A Labrador of ~30 kg, 0.54 m at the withers, standing square (public/models/dog.glb): its joints where the mesh has them (left and
 * right averaged), its body 2 cm lower, its elbows and stifles bent to it.
 */
export const DOG = [
  { name: 'trunk', position: [0, 0.45, 0.04] },
  { name: 'pelvis', parent: 'trunk', position: [0, 0.46, -0.21] },
  { name: 'neck', parent: 'trunk', position: [0, 0.46, 0.24] },
  { name: 'head', parent: 'neck', position: [0, 0.59, 0.33] },
  { name: 'jaw', parent: 'head', position: [0, 0.53, 0.5] },
  { name: 'tail', parent: 'pelvis', position: [0, 0.48, -0.32] },
  { name: 'leftFore0', parent: 'trunk', position: [0.07, 0.474, 0.238] },
  { name: 'leftFore1', parent: 'leftFore0', position: [0.06, 0.297, 0.169] },
  { name: 'leftFore2', parent: 'leftFore1', position: [0.075, 0.094, 0.231] },
  { name: 'leftFore3', parent: 'leftFore2', position: [0.081, 0.035, 0.271] },
  { name: 'rightFore0', parent: 'trunk', position: [-0.07, 0.474, 0.238] },
  { name: 'rightFore1', parent: 'rightFore0', position: [-0.06, 0.297, 0.169] },
  { name: 'rightFore2', parent: 'rightFore1', position: [-0.075, 0.094, 0.231] },
  { name: 'rightFore3', parent: 'rightFore2', position: [-0.081, 0.035, 0.271] },
  { name: 'leftHind0', parent: 'pelvis', position: [0.07, 0.474, -0.233] },
  { name: 'leftHind1', parent: 'leftHind0', position: [0.054, 0.302, -0.191] },
  { name: 'leftHind2', parent: 'leftHind1', position: [0.064, 0.165, -0.329] },
  { name: 'leftHind3', parent: 'leftHind2', position: [0.077, 0.035, -0.308] },
  { name: 'rightHind0', parent: 'pelvis', position: [-0.07, 0.474, -0.233] },
  { name: 'rightHind1', parent: 'rightHind0', position: [-0.054, 0.302, -0.191] },
  { name: 'rightHind2', parent: 'rightHind1', position: [-0.064, 0.165, -0.329] },
  { name: 'rightHind3', parent: 'rightHind2', position: [-0.077, 0.035, -0.308] },
] as const satisfies readonly SkeletonBone[];

/**
 * A lion of ~190 kg, 1.0 m at the withers, standing square (public/models/lion.glb): each leg's top, elbow or stifle, wrist or hock and
 * paw (the elbow bending back, the stifle forward, the hock high and back as a cat's), a spine between trunk and pelvis, a long tail.
 */
export const LION = [
  { name: 'trunk', position: [0, 0.97, 0.2] },
  { name: 'spine', parent: 'trunk', position: [0, 0.97, -0.15] },
  { name: 'pelvis', parent: 'spine', position: [0, 0.95, -0.42] },
  { name: 'neck', parent: 'trunk', position: [0, 0.95, 0.55] },
  { name: 'head', parent: 'neck', position: [0, 1.15, 0.86] },
  { name: 'jaw', parent: 'head', position: [0, 1.0, 1.1] },
  { name: 'tail', parent: 'pelvis', position: [0, 0.97, -0.62] },
  { name: 'tailTip', parent: 'tail', position: [0, 0.45, -1.2] },
  { name: 'leftFore0', parent: 'trunk', position: [0.15, 0.95, 0.45] },
  { name: 'leftFore1', parent: 'leftFore0', position: [0.15, 0.6, 0.27] },
  { name: 'leftFore2', parent: 'leftFore1', position: [0.15, 0.22, 0.42] },
  { name: 'leftFore3', parent: 'leftFore2', position: [0.15, 0.06, 0.5] },
  { name: 'rightFore0', parent: 'trunk', position: [-0.15, 0.95, 0.45] },
  { name: 'rightFore1', parent: 'rightFore0', position: [-0.15, 0.6, 0.27] },
  { name: 'rightFore2', parent: 'rightFore1', position: [-0.15, 0.22, 0.42] },
  { name: 'rightFore3', parent: 'rightFore2', position: [-0.15, 0.06, 0.5] },
  { name: 'leftHind0', parent: 'pelvis', position: [0.15, 0.93, -0.5] },
  { name: 'leftHind1', parent: 'leftHind0', position: [0.15, 0.62, -0.27] },
  { name: 'leftHind2', parent: 'leftHind1', position: [0.15, 0.3, -0.68] },
  { name: 'leftHind3', parent: 'leftHind2', position: [0.15, 0.06, -0.56] },
  { name: 'rightHind0', parent: 'pelvis', position: [-0.15, 0.93, -0.5] },
  { name: 'rightHind1', parent: 'rightHind0', position: [-0.15, 0.62, -0.27] },
  { name: 'rightHind2', parent: 'rightHind1', position: [-0.15, 0.3, -0.68] },
  { name: 'rightHind3', parent: 'rightHind2', position: [-0.15, 0.06, -0.56] },
] as const satisfies readonly SkeletonBone[];
