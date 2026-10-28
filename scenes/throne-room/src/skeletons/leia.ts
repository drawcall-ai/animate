// Measured on public/models/leia.glb (1.55 m to its crown, standing in a T-pose): absolute model-space positions in metres, +Y up, +Z forward, +X left.
import type { SkeletonBone } from '@drawcall/rig';

/** Leia in her white gown (the legs are placed inside the skirt, which hides the feet). */
export const LEIA = [
  { name: 'hips', position: [0, 0.821, 0.011] },
  { name: 'spine', parent: 'hips', position: [0, 0.93, 0.025] },
  { name: 'chest', parent: 'spine', position: [0, 1.085, 0.041] },
  { name: 'neck', parent: 'chest', position: [0, 1.268, 0.005] },
  { name: 'head', parent: 'neck', position: [0, 1.356, 0.047] },
  { name: 'head_end', parent: 'head', position: [0, 1.55, 0.047] },
  { name: 'leftShoulder', parent: 'chest', position: [0.031, 1.256, 0.011] },
  { name: 'leftUpperArm', parent: 'leftShoulder', position: [0.17, 1.241, 0.011] },
  { name: 'leftLowerArm', parent: 'leftUpperArm', position: [0.386, 1.209, -0.058] },
  { name: 'leftHand', parent: 'leftLowerArm', position: [0.556, 1.195, -0.015] },
  { name: 'leftHand_end', parent: 'leftHand', position: [0.688, 1.181, 0.003] },
  { name: 'rightShoulder', parent: 'chest', position: [-0.031, 1.256, 0.011] },
  { name: 'rightUpperArm', parent: 'rightShoulder', position: [-0.17, 1.241, 0.011] },
  { name: 'rightLowerArm', parent: 'rightUpperArm', position: [-0.388, 1.209, -0.058] },
  { name: 'rightHand', parent: 'rightLowerArm', position: [-0.559, 1.194, -0.016] },
  { name: 'rightHand_end', parent: 'rightHand', position: [-0.691, 1.18, 0.004] },
  { name: 'leftUpperLeg', parent: 'hips', position: [0.082, 0.79, 0.012] },
  { name: 'leftLowerLeg', parent: 'leftUpperLeg', position: [0.091, 0.442, 0.004] },
  { name: 'leftFoot', parent: 'leftLowerLeg', position: [0.101, 0.07, -0.098] },
  { name: 'leftToes', parent: 'leftFoot', position: [0.101, 0.031, 0.093] },
  { name: 'leftToes_end', parent: 'leftToes', position: [0.101, 0.023, 0.173] },
  { name: 'rightUpperLeg', parent: 'hips', position: [-0.096, 0.79, 0.011] },
  { name: 'rightLowerLeg', parent: 'rightUpperLeg', position: [-0.099, 0.442, 0.007] },
  { name: 'rightFoot', parent: 'rightLowerLeg', position: [-0.102, 0.07, -0.101] },
  { name: 'rightToes', parent: 'rightFoot', position: [-0.102, 0.031, 0.105] },
  { name: 'rightToes_end', parent: 'rightToes', position: [-0.102, 0.023, 0.193] },
] as const satisfies readonly SkeletonBone[];
