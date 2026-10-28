// Measured on public/models/threepio.glb (1.75 m to its crown, standing in a T-pose): absolute model-space positions in metres, +Y up, +Z forward, +X left.
import type { SkeletonBone } from '@drawcall/rig';

/** C-3PO, gold plated. */
export const THREEPIO = [
  { name: 'hips', position: [0, 0.927, -0.028] },
  { name: 'spine', parent: 'hips', position: [0, 1.05, -0.037] },
  { name: 'chest', parent: 'spine', position: [0, 1.225, -0.008] },
  { name: 'neck', parent: 'chest', position: [0, 1.431, -0.05] },
  { name: 'head', parent: 'neck', position: [0, 1.531, -0.002] },
  { name: 'head_end', parent: 'head', position: [0, 1.75, -0.002] },
  { name: 'leftShoulder', parent: 'chest', position: [0.035, 1.427, -0.041] },
  { name: 'leftUpperArm', parent: 'leftShoulder', position: [0.175, 1.409, -0.041] },
  { name: 'leftLowerArm', parent: 'leftUpperArm', position: [0.335, 1.384, -0.092] },
  { name: 'leftHand', parent: 'leftLowerArm', position: [0.46, 1.37, -0.022] },
  { name: 'leftHand_end', parent: 'leftHand', position: [0.609, 1.342, 0.018] },
  { name: 'rightShoulder', parent: 'chest', position: [-0.035, 1.427, -0.041] },
  { name: 'rightUpperArm', parent: 'rightShoulder', position: [-0.175, 1.409, -0.041] },
  { name: 'rightLowerArm', parent: 'rightUpperArm', position: [-0.335, 1.384, -0.092] },
  { name: 'rightHand', parent: 'rightLowerArm', position: [-0.46, 1.37, -0.022] },
  { name: 'rightHand_end', parent: 'rightHand', position: [-0.609, 1.342, 0.018] },
  { name: 'leftUpperLeg', parent: 'hips', position: [0.131, 0.892, -0.027] },
  { name: 'leftLowerLeg', parent: 'leftUpperLeg', position: [0.165, 0.499, -0.067] },
  { name: 'leftFoot', parent: 'leftLowerLeg', position: [0.198, 0.079, -0.078] },
  { name: 'leftToes', parent: 'leftFoot', position: [0.198, 0.035, 0.063] },
  { name: 'leftToes_end', parent: 'leftToes', position: [0.198, 0.026, 0.117] },
  { name: 'rightUpperLeg', parent: 'hips', position: [-0.131, 0.892, -0.028] },
  { name: 'rightLowerLeg', parent: 'rightUpperLeg', position: [-0.165, 0.499, -0.067] },
  { name: 'rightFoot', parent: 'rightLowerLeg', position: [-0.197, 0.079, -0.079] },
  { name: 'rightToes', parent: 'rightFoot', position: [-0.197, 0.035, 0.063] },
  { name: 'rightToes_end', parent: 'rightToes', position: [-0.197, 0.026, 0.116] },
] as const satisfies readonly SkeletonBone[];
