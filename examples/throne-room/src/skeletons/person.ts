// Absolute model-space positions in metres: +Y up, +Z forward, +X left.
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
