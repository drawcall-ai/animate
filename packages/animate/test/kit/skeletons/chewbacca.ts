// Measured on public/models/chewbacca.glb (2.28 m to its crown, standing in a T-pose): absolute model-space positions in metres, +Y up, +Z forward, +X left.
import type { SkeletonBone } from '@drawcall/rig';

/** Chewbacca, fur and bandolier. */
export const CHEWBACCA = [
  { name: 'hips', position: [0, 1.208, -0.047] },
  { name: 'spine', parent: 'hips', position: [0, 1.368, -0.021] },
  { name: 'chest', parent: 'spine', position: [0, 1.595, -0.042] },
  { name: 'neck', parent: 'chest', position: [0, 1.864, -0.086] },
  { name: 'head', parent: 'neck', position: [0, 1.994, -0.044] },
  { name: 'head_end', parent: 'head', position: [0, 2.279, -0.044] },
  { name: 'leftShoulder', parent: 'chest', position: [0.046, 1.945, -0.077] },
  { name: 'leftUpperArm', parent: 'leftShoulder', position: [0.228, 1.922, -0.077] },
  { name: 'leftLowerArm', parent: 'leftUpperArm', position: [0.421, 1.829, -0.188] },
  { name: 'leftHand', parent: 'leftLowerArm', position: [0.573, 1.8, 0.004] },
  { name: 'leftHand_end', parent: 'leftHand', position: [0.766, 1.767, 0.164] },
  { name: 'rightShoulder', parent: 'chest', position: [-0.046, 1.945, -0.077] },
  { name: 'rightUpperArm', parent: 'rightShoulder', position: [-0.228, 1.922, -0.077] },
  { name: 'rightLowerArm', parent: 'rightUpperArm', position: [-0.425, 1.827, -0.18] },
  { name: 'rightHand', parent: 'rightLowerArm', position: [-0.581, 1.8, 0.01] },
  { name: 'rightHand_end', parent: 'rightHand', position: [-0.774, 1.762, 0.164] },
  { name: 'leftUpperLeg', parent: 'hips', position: [0.162, 1.162, -0.048] },
  { name: 'leftLowerLeg', parent: 'leftUpperLeg', position: [0.196, 0.65, -0.035] },
  { name: 'leftFoot', parent: 'leftLowerLeg', position: [0.232, 0.103, -0.13] },
  { name: 'leftToes', parent: 'leftFoot', position: [0.232, 0.046, 0.08] },
  { name: 'leftToes_end', parent: 'leftToes', position: [0.232, 0.034, 0.162] },
  { name: 'rightUpperLeg', parent: 'hips', position: [-0.165, 1.162, -0.052] },
  { name: 'rightLowerLeg', parent: 'rightUpperLeg', position: [-0.199, 0.65, -0.038] },
  { name: 'rightFoot', parent: 'rightLowerLeg', position: [-0.235, 0.103, -0.126] },
  { name: 'rightToes', parent: 'rightFoot', position: [-0.235, 0.046, 0.081] },
  { name: 'rightToes_end', parent: 'rightToes', position: [-0.235, 0.034, 0.163] },
] as const satisfies readonly SkeletonBone[];
