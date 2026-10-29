// Measured on public/models/dodonna.glb (1.82 m to its crown, standing in a T-pose): absolute model-space positions in metres, +Y up, +Z forward, +X left.
import type { SkeletonBone } from '@drawcall/rig';

/** General Dodonna, grey beard and uniform. */
export const DODONNA = [
  { name: 'hips', position: [0, 0.965, -0.007] },
  { name: 'spine', parent: 'hips', position: [0, 1.092, 0.004] },
  { name: 'chest', parent: 'spine', position: [0, 1.274, -0.001] },
  { name: 'neck', parent: 'chest', position: [0, 1.489, -0.043] },
  { name: 'head', parent: 'neck', position: [0, 1.592, 0.009] },
  { name: 'head_end', parent: 'head', position: [0, 1.82, 0.009] },
  { name: 'leftShoulder', parent: 'chest', position: [0.036, 1.488, -0.041] },
  { name: 'leftUpperArm', parent: 'leftShoulder', position: [0.182, 1.47, -0.041] },
  { name: 'leftLowerArm', parent: 'leftUpperArm', position: [0.372, 1.384, -0.093] },
  { name: 'leftHand', parent: 'leftLowerArm', position: [0.522, 1.337, 0.016] },
  { name: 'leftHand_end', parent: 'leftHand', position: [0.677, 1.318, 0.074] },
  { name: 'rightShoulder', parent: 'chest', position: [-0.036, 1.486, -0.041] },
  { name: 'rightUpperArm', parent: 'rightShoulder', position: [-0.182, 1.468, -0.041] },
  { name: 'rightLowerArm', parent: 'rightUpperArm', position: [-0.372, 1.384, -0.093] },
  { name: 'rightHand', parent: 'rightLowerArm', position: [-0.522, 1.337, 0.016] },
  { name: 'rightHand_end', parent: 'rightHand', position: [-0.677, 1.318, 0.074] },
  { name: 'leftUpperLeg', parent: 'hips', position: [0.127, 0.928, -0.015] },
  { name: 'leftLowerLeg', parent: 'leftUpperLeg', position: [0.169, 0.519, -0.048] },
  { name: 'leftFoot', parent: 'leftLowerLeg', position: [0.215, 0.082, -0.084] },
  { name: 'leftToes', parent: 'leftFoot', position: [0.215, 0.036, 0.069] },
  { name: 'leftToes_end', parent: 'leftToes', position: [0.215, 0.027, 0.127] },
  { name: 'rightUpperLeg', parent: 'hips', position: [-0.123, 0.928, -0.009] },
  { name: 'rightLowerLeg', parent: 'rightUpperLeg', position: [-0.168, 0.519, -0.049] },
  { name: 'rightFoot', parent: 'rightLowerLeg', position: [-0.216, 0.082, -0.084] },
  { name: 'rightToes', parent: 'rightFoot', position: [-0.216, 0.036, 0.069] },
  { name: 'rightToes_end', parent: 'rightToes', position: [-0.216, 0.027, 0.127] },
] as const satisfies readonly SkeletonBone[];
