// Measured on public/models/bearer.glb (1.8 m to its crown, standing in a T-pose): absolute model-space positions in metres, +Y up, +Z forward, +X left.
import type { SkeletonBone } from '@drawcall/rig';

/** The officer who hands Leia the medals. */
export const MEDAL_BEARER = [
  { name: 'hips', position: [0, 0.954, 0.003] },
  { name: 'spine', parent: 'hips', position: [0, 1.08, 0.018] },
  { name: 'chest', parent: 'spine', position: [0, 1.26, 0.009] },
  { name: 'neck', parent: 'chest', position: [0, 1.472, -0.026] },
  { name: 'head', parent: 'neck', position: [0, 1.575, 0.021] },
  { name: 'head_end', parent: 'head', position: [0, 1.8, 0.021] },
  { name: 'leftShoulder', parent: 'chest', position: [0.036, 1.488, -0.026] },
  { name: 'leftUpperArm', parent: 'leftShoulder', position: [0.18, 1.471, -0.026] },
  { name: 'leftLowerArm', parent: 'leftUpperArm', position: [0.391, 1.363, -0.088] },
  { name: 'leftHand', parent: 'leftLowerArm', position: [0.556, 1.303, -0.001] },
  { name: 'leftHand_end', parent: 'leftHand', position: [0.709, 1.278, 0.031] },
  { name: 'rightShoulder', parent: 'chest', position: [-0.036, 1.488, -0.026] },
  { name: 'rightUpperArm', parent: 'rightShoulder', position: [-0.18, 1.47, -0.026] },
  { name: 'rightLowerArm', parent: 'rightUpperArm', position: [-0.391, 1.363, -0.088] },
  { name: 'rightHand', parent: 'rightLowerArm', position: [-0.557, 1.302, -0.001] },
  { name: 'rightHand_end', parent: 'rightHand', position: [-0.71, 1.277, 0.031] },
  { name: 'leftUpperLeg', parent: 'hips', position: [0.12, 0.918, -0.001] },
  { name: 'leftLowerLeg', parent: 'leftUpperLeg', position: [0.168, 0.513, -0.038] },
  { name: 'leftFoot', parent: 'leftLowerLeg', position: [0.219, 0.081, -0.079] },
  { name: 'leftToes', parent: 'leftFoot', position: [0.219, 0.036, 0.069] },
  { name: 'leftToes_end', parent: 'leftToes', position: [0.219, 0.027, 0.125] },
  { name: 'rightUpperLeg', parent: 'hips', position: [-0.119, 0.918, 0.004] },
  { name: 'rightLowerLeg', parent: 'rightUpperLeg', position: [-0.17, 0.513, -0.038] },
  { name: 'rightFoot', parent: 'rightLowerLeg', position: [-0.224, 0.081, -0.079] },
  { name: 'rightToes', parent: 'rightFoot', position: [-0.224, 0.036, 0.069] },
  { name: 'rightToes_end', parent: 'rightToes', position: [-0.224, 0.027, 0.125] },
] as const satisfies readonly SkeletonBone[];
