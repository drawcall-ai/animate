// Measured on the throne-room-r2 scene's trooper.glb (1.8 m to its crown, in a T-pose): absolute model-space positions in metres, +Y up, +Z forward, +X left.
import type { SkeletonBone } from '@drawcall/rig';

/** A Rebel trooper of the ranks: a light model (6k triangles, 512 px textures) for the crowd. */
export const TROOPER = [
  { name: 'hips', position: [0, 0.954, 0.006] },
  { name: 'spine', parent: 'hips', position: [0, 1.08, 0.012] },
  { name: 'chest', parent: 'spine', position: [0, 1.26, 0.006] },
  { name: 'neck', parent: 'chest', position: [0, 1.472, -0.021] },
  { name: 'head', parent: 'neck', position: [0, 1.575, 0.016] },
  { name: 'head_end', parent: 'head', position: [0, 1.8, 0.016] },
  { name: 'leftShoulder', parent: 'chest', position: [0.036, 1.465, -0.022] },
  { name: 'leftUpperArm', parent: 'leftShoulder', position: [0.18, 1.447, -0.022] },
  { name: 'leftLowerArm', parent: 'leftUpperArm', position: [0.39, 1.385, -0.101] },
  { name: 'leftHand', parent: 'leftLowerArm', position: [0.556, 1.348, -0.033] },
  { name: 'leftHand_end', parent: 'leftHand', position: [0.709, 1.325, -0.018] },
  { name: 'rightShoulder', parent: 'chest', position: [-0.036, 1.465, -0.022] },
  { name: 'rightUpperArm', parent: 'rightShoulder', position: [-0.18, 1.447, -0.022] },
  { name: 'rightLowerArm', parent: 'rightUpperArm', position: [-0.391, 1.385, -0.101] },
  { name: 'rightHand', parent: 'rightLowerArm', position: [-0.556, 1.348, -0.033] },
  { name: 'rightHand_end', parent: 'rightHand', position: [-0.709, 1.325, -0.015] },
  { name: 'leftUpperLeg', parent: 'hips', position: [0.117, 0.918, -0.014] },
  { name: 'leftLowerLeg', parent: 'leftUpperLeg', position: [0.16, 0.513, -0.019] },
  { name: 'leftFoot', parent: 'leftLowerLeg', position: [0.205, 0.081, -0.075] },
  { name: 'leftToes', parent: 'leftFoot', position: [0.205, 0.036, 0.074] },
  { name: 'leftToes_end', parent: 'leftToes', position: [0.205, 0.027, 0.131] },
  { name: 'rightUpperLeg', parent: 'hips', position: [-0.118, 0.918, -0.009] },
  { name: 'rightLowerLeg', parent: 'rightUpperLeg', position: [-0.161, 0.513, -0.018] },
  { name: 'rightFoot', parent: 'rightLowerLeg', position: [-0.206, 0.081, -0.075] },
  { name: 'rightToes', parent: 'rightFoot', position: [-0.206, 0.036, 0.074] },
  { name: 'rightToes_end', parent: 'rightToes', position: [-0.206, 0.027, 0.131] },
] as const satisfies readonly SkeletonBone[];
