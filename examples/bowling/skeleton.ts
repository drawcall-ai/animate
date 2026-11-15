import { CachedRigLoader } from '@drawcall/rig'
import { rigging } from '../served'
import type { Landmarks } from '../humanoid'

/**
 * Where the bowler's joints are, measured on his model (public/models/bowler.glb) by cross-sections of its solid (m):
 * standing on y = 0 with his arms out and palms down, facing +z, his left at +x. He is 1.78 m to his crown, his arms
 * a little below level, his trousers loose down to his shoes, his fingers spread with the index a little lower and
 * the short thumb hanging down ahead; both sides measured alike, so the right is the left mirrored.
 */
export const landmarks: Landmarks = {
  hips: [0, 0.88, -0.015],
  spine: [0, 0.99, -0.015],
  chest: [0, 1.18, -0.02],
  neck: [0, 1.49, -0.05],
  head: [0, 1.565, -0.01],
  crown: [0, 1.775, 0],
  left: {
    shoulder: [0.04, 1.42, -0.05],
    arm: [0.185, 1.385, -0.055],
    elbow: [0.45, 1.387, -0.06],
    wrist: [0.68, 1.383, -0.011],
    thumb: [0.71, 1.36, 0.025],
    tips: {
      thumb: [0.784, 1.311, 0.092],
      index: [0.862, 1.35, 0.074],
      middle: [0.884, 1.382, 0.044],
      ring: [0.88, 1.391, -0.002],
      little: [0.855, 1.388, -0.04],
    },
    hip: [0.095, 0.865, -0.015],
    knee: [0.135, 0.5, -0.033],
    ankle: [0.17, 0.085, -0.075],
    ball: [0.185, 0.035, 0.06],
    toe: [0.195, 0.03, 0.155],
  },
}

/**
 * The bowler rigged to his skeleton, which is `humanoid(landmarks)` of ../humanoid written out: the vitecache plugin
 * rigs him ahead, in Node, for a load it reads as it is written.
 */
export const rig = () =>
  new CachedRigLoader(rigging.manager, rigging.cache).loadAsync({
    url: '/models/bowler.glb',
    resolution: 512,
    skeleton: [
      { name: 'hips', position: [0, 0.88, -0.015] },
      { name: 'spine', parent: 'hips', position: [0, 0.99, -0.015] },
      { name: 'chest', parent: 'spine', position: [0, 1.18, -0.02] },
      { name: 'neck', parent: 'chest', position: [0, 1.49, -0.05] },
      { name: 'head', parent: 'neck', position: [0, 1.565, -0.01] },
      { name: 'head_end', parent: 'head', position: [0, 1.775, 0] },
      { name: 'leftShoulder', parent: 'chest', position: [0.04, 1.42, -0.05] },
      { name: 'leftUpperArm', parent: 'leftShoulder', position: [0.185, 1.385, -0.055] },
      { name: 'leftLowerArm', parent: 'leftUpperArm', position: [0.45, 1.387, -0.06] },
      { name: 'leftHand', parent: 'leftLowerArm', position: [0.68, 1.383, -0.011] },
      { name: 'leftMiddleProximal', parent: 'leftHand', position: [0.792, 1.382, 0.019] },
      { name: 'leftMiddleIntermediate', parent: 'leftMiddleProximal', position: [0.835, 1.382, 0.031] },
      { name: 'leftMiddleDistal', parent: 'leftMiddleIntermediate', position: [0.863, 1.382, 0.038] },
      { name: 'leftMiddleDistal_end', parent: 'leftMiddleDistal', position: [0.884, 1.382, 0.044] },
      { name: 'leftIndexProximal', parent: 'leftHand', position: [0.78, 1.365, 0.036] },
      { name: 'leftIndexIntermediate', parent: 'leftIndexProximal', position: [0.819, 1.358, 0.054] },
      { name: 'leftIndexDistal', parent: 'leftIndexIntermediate', position: [0.843, 1.353, 0.065] },
      { name: 'leftIndexDistal_end', parent: 'leftIndexDistal', position: [0.862, 1.35, 0.074] },
      { name: 'leftRingProximal', parent: 'leftHand', position: [0.79, 1.387, -0.006] },
      { name: 'leftRingIntermediate', parent: 'leftRingProximal', position: [0.832, 1.389, -0.004] },
      { name: 'leftRingDistal', parent: 'leftRingIntermediate', position: [0.859, 1.39, -0.003] },
      { name: 'leftRingDistal_end', parent: 'leftRingDistal', position: [0.88, 1.391, -0.002] },
      { name: 'leftLittleProximal', parent: 'leftHand', position: [0.771, 1.386, -0.026] },
      { name: 'leftLittleIntermediate', parent: 'leftLittleProximal', position: [0.81, 1.387, -0.033] },
      { name: 'leftLittleDistal', parent: 'leftLittleIntermediate', position: [0.836, 1.387, -0.037] },
      { name: 'leftLittleDistal_end', parent: 'leftLittleDistal', position: [0.855, 1.388, -0.04] },
      { name: 'leftThumbMetacarpal', parent: 'leftHand', position: [0.71, 1.36, 0.025] },
      { name: 'leftThumbProximal', parent: 'leftThumbMetacarpal', position: [0.741, 1.339, 0.053] },
      { name: 'leftThumbDistal', parent: 'leftThumbProximal', position: [0.765, 1.324, 0.075] },
      { name: 'leftThumbDistal_end', parent: 'leftThumbDistal', position: [0.784, 1.311, 0.092] },
      { name: 'leftUpperLeg', parent: 'hips', position: [0.095, 0.865, -0.015] },
      { name: 'leftLowerLeg', parent: 'leftUpperLeg', position: [0.135, 0.5, -0.033] },
      { name: 'leftFoot', parent: 'leftLowerLeg', position: [0.17, 0.085, -0.075] },
      { name: 'leftToes', parent: 'leftFoot', position: [0.185, 0.035, 0.06] },
      { name: 'leftToes_end', parent: 'leftToes', position: [0.195, 0.03, 0.155] },
      { name: 'rightShoulder', parent: 'chest', position: [-0.04, 1.42, -0.05] },
      { name: 'rightUpperArm', parent: 'rightShoulder', position: [-0.185, 1.385, -0.055] },
      { name: 'rightLowerArm', parent: 'rightUpperArm', position: [-0.45, 1.387, -0.06] },
      { name: 'rightHand', parent: 'rightLowerArm', position: [-0.68, 1.383, -0.011] },
      { name: 'rightMiddleProximal', parent: 'rightHand', position: [-0.792, 1.382, 0.019] },
      { name: 'rightMiddleIntermediate', parent: 'rightMiddleProximal', position: [-0.835, 1.382, 0.031] },
      { name: 'rightMiddleDistal', parent: 'rightMiddleIntermediate', position: [-0.863, 1.382, 0.038] },
      { name: 'rightMiddleDistal_end', parent: 'rightMiddleDistal', position: [-0.884, 1.382, 0.044] },
      { name: 'rightIndexProximal', parent: 'rightHand', position: [-0.78, 1.365, 0.036] },
      { name: 'rightIndexIntermediate', parent: 'rightIndexProximal', position: [-0.819, 1.358, 0.054] },
      { name: 'rightIndexDistal', parent: 'rightIndexIntermediate', position: [-0.843, 1.353, 0.065] },
      { name: 'rightIndexDistal_end', parent: 'rightIndexDistal', position: [-0.862, 1.35, 0.074] },
      { name: 'rightRingProximal', parent: 'rightHand', position: [-0.79, 1.387, -0.006] },
      { name: 'rightRingIntermediate', parent: 'rightRingProximal', position: [-0.832, 1.389, -0.004] },
      { name: 'rightRingDistal', parent: 'rightRingIntermediate', position: [-0.859, 1.39, -0.003] },
      { name: 'rightRingDistal_end', parent: 'rightRingDistal', position: [-0.88, 1.391, -0.002] },
      { name: 'rightLittleProximal', parent: 'rightHand', position: [-0.771, 1.386, -0.026] },
      { name: 'rightLittleIntermediate', parent: 'rightLittleProximal', position: [-0.81, 1.387, -0.033] },
      { name: 'rightLittleDistal', parent: 'rightLittleIntermediate', position: [-0.836, 1.387, -0.037] },
      { name: 'rightLittleDistal_end', parent: 'rightLittleDistal', position: [-0.855, 1.388, -0.04] },
      { name: 'rightThumbMetacarpal', parent: 'rightHand', position: [-0.71, 1.36, 0.025] },
      { name: 'rightThumbProximal', parent: 'rightThumbMetacarpal', position: [-0.741, 1.339, 0.053] },
      { name: 'rightThumbDistal', parent: 'rightThumbProximal', position: [-0.765, 1.324, 0.075] },
      { name: 'rightThumbDistal_end', parent: 'rightThumbDistal', position: [-0.784, 1.311, 0.092] },
      { name: 'rightUpperLeg', parent: 'hips', position: [-0.095, 0.865, -0.015] },
      { name: 'rightLowerLeg', parent: 'rightUpperLeg', position: [-0.135, 0.5, -0.033] },
      { name: 'rightFoot', parent: 'rightLowerLeg', position: [-0.17, 0.085, -0.075] },
      { name: 'rightToes', parent: 'rightFoot', position: [-0.185, 0.035, 0.06] },
      { name: 'rightToes_end', parent: 'rightToes', position: [-0.195, 0.03, 0.155] },
    ],
  })
