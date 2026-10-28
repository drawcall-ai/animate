// Measured on public/models/han.glb (1.85 m to its crown, standing in a T-pose): absolute model-space positions in metres, +Y up, +Z forward, +X left.
import type { SkeletonBone } from '@drawcall/rig';

/** Han in vest and boots. */
export const HAN = [
  { name: 'hips', position: [0, 0.98, -0.032] },
  { name: 'spine', parent: 'hips', position: [0, 1.11, -0.007] },
  { name: 'chest', parent: 'spine', position: [0, 1.295, -0.028] },
  { name: 'neck', parent: 'chest', position: [0, 1.513, -0.059] },
  { name: 'head', parent: 'neck', position: [0, 1.619, -0.009] },
  { name: 'head_end', parent: 'head', position: [0, 1.85, -0.009] },
  { name: 'leftShoulder', parent: 'chest', position: [0.037, 1.528, -0.053] },
  { name: 'leftUpperArm', parent: 'leftShoulder', position: [0.185, 1.509, -0.053] },
  { name: 'leftLowerArm', parent: 'leftUpperArm', position: [0.362, 1.422, -0.133] },
  { name: 'leftHand', parent: 'leftLowerArm', position: [0.501, 1.369, -0.02] },
  { name: 'leftHand_end', parent: 'leftHand', position: [0.659, 1.311, 0.106] },
  { name: 'rightShoulder', parent: 'chest', position: [-0.037, 1.528, -0.053] },
  { name: 'rightUpperArm', parent: 'rightShoulder', position: [-0.185, 1.509, -0.053] },
  { name: 'rightLowerArm', parent: 'rightUpperArm', position: [-0.362, 1.422, -0.133] },
  { name: 'rightHand', parent: 'rightLowerArm', position: [-0.501, 1.369, -0.02] },
  { name: 'rightHand_end', parent: 'rightHand', position: [-0.658, 1.313, 0.106] },
  { name: 'leftUpperLeg', parent: 'hips', position: [0.131, 0.943, -0.035] },
  { name: 'leftLowerLeg', parent: 'leftUpperLeg', position: [0.177, 0.527, -0.051] },
  { name: 'leftFoot', parent: 'leftLowerLeg', position: [0.227, 0.083, -0.081] },
  { name: 'leftToes', parent: 'leftFoot', position: [0.227, 0.037, 0.074] },
  { name: 'leftToes_end', parent: 'leftToes', position: [0.227, 0.028, 0.133] },
  { name: 'rightUpperLeg', parent: 'hips', position: [-0.136, 0.943, -0.032] },
  { name: 'rightLowerLeg', parent: 'rightUpperLeg', position: [-0.18, 0.527, -0.055] },
  { name: 'rightFoot', parent: 'rightLowerLeg', position: [-0.227, 0.083, -0.081] },
  { name: 'rightToes', parent: 'rightFoot', position: [-0.227, 0.037, 0.074] },
  { name: 'rightToes_end', parent: 'rightToes', position: [-0.227, 0.028, 0.133] },
] as const satisfies readonly SkeletonBone[];
