// Measured on public/models/luke.glb (1.72 m to its crown, standing in a T-pose): absolute model-space positions in metres, +Y up, +Z forward, +X left.
import type { SkeletonBone } from '@drawcall/rig';

/** Luke in his ceremonial jacket. */
export const LUKE = [
  { name: 'hips', position: [0, 0.911, -0.024] },
  { name: 'spine', parent: 'hips', position: [0, 1.032, -0.017] },
  { name: 'chest', parent: 'spine', position: [0, 1.204, -0.023] },
  { name: 'neck', parent: 'chest', position: [0, 1.406, -0.047] },
  { name: 'head', parent: 'neck', position: [0, 1.504, -0.005] },
  { name: 'head_end', parent: 'head', position: [0, 1.719, -0.005] },
  { name: 'leftShoulder', parent: 'chest', position: [0.034, 1.399, -0.042] },
  { name: 'leftUpperArm', parent: 'leftShoulder', position: [0.172, 1.382, -0.042] },
  { name: 'leftLowerArm', parent: 'leftUpperArm', position: [0.374, 1.29, -0.101] },
  { name: 'leftHand', parent: 'leftLowerArm', position: [0.532, 1.245, 0.002] },
  { name: 'leftHand_end', parent: 'leftHand', position: [0.679, 1.227, 0.049] },
  { name: 'rightShoulder', parent: 'chest', position: [-0.034, 1.403, -0.042] },
  { name: 'rightUpperArm', parent: 'rightShoulder', position: [-0.172, 1.386, -0.042] },
  { name: 'rightLowerArm', parent: 'rightUpperArm', position: [-0.375, 1.289, -0.101] },
  { name: 'rightHand', parent: 'rightLowerArm', position: [-0.534, 1.244, 0.006] },
  { name: 'rightHand_end', parent: 'rightHand', position: [-0.68, 1.227, 0.049] },
  { name: 'leftUpperLeg', parent: 'hips', position: [0.114, 0.877, -0.024] },
  { name: 'leftLowerLeg', parent: 'leftUpperLeg', position: [0.158, 0.49, -0.035] },
  { name: 'leftFoot', parent: 'leftLowerLeg', position: [0.204, 0.077, -0.083] },
  { name: 'leftToes', parent: 'leftFoot', position: [0.204, 0.034, 0.057] },
  { name: 'leftToes_end', parent: 'leftToes', position: [0.204, 0.026, 0.109] },
  { name: 'rightUpperLeg', parent: 'hips', position: [-0.118, 0.877, -0.024] },
  { name: 'rightLowerLeg', parent: 'rightUpperLeg', position: [-0.162, 0.49, -0.03] },
  { name: 'rightFoot', parent: 'rightLowerLeg', position: [-0.209, 0.077, -0.083] },
  { name: 'rightToes', parent: 'rightFoot', position: [-0.209, 0.034, 0.057] },
  { name: 'rightToes_end', parent: 'rightToes', position: [-0.209, 0.026, 0.109] },
] as const satisfies readonly SkeletonBone[];
