import { CachedRigLoader } from '@drawcall/rig'
import { rigging } from '../served'
import type { Landmarks } from '../humanoid'

/**
 * Where the player's joints are, measured on his model (public/models/player.glb) by cross-sections of its solid (m):
 * standing on y = 0 with his arms out and palms down, facing +z, his left at +x. He is 1.95 m to his crown, his arms
 * short for his height and nearly level, his legs a little apart, his hands turned a little ahead with the fingers
 * spread and the thumb under the index; both sides measured alike, so the right is the left mirrored.
 */
export const landmarks: Landmarks = {
  hips: [0, 0.95, -0.01],
  spine: [0, 1.08, -0.005],
  chest: [0, 1.28, -0.01],
  neck: [0, 1.63, -0.05],
  head: [0, 1.71, -0.02],
  crown: [0, 1.94, -0.005],
  left: {
    shoulder: [0.04, 1.56, -0.05],
    arm: [0.2, 1.56, -0.057],
    elbow: [0.49, 1.534, -0.054],
    wrist: [0.755, 1.525, 0.013],
    thumb: [0.78, 1.5, 0.045],
    tips: {
      thumb: [0.866, 1.466, 0.139],
      index: [0.952, 1.522, 0.123],
      middle: [0.973, 1.505, 0.089],
      ring: [0.961, 1.486, 0.05],
      little: [0.941, 1.472, 0.009],
    },
    hip: [0.1, 0.93, -0.005],
    knee: [0.166, 0.545, -0.045],
    ankle: [0.21, 0.11, -0.075],
    ball: [0.228, 0.035, 0.07],
    toe: [0.235, 0.03, 0.16],
  },
}

/**
 * The player rigged to his skeleton, which is `humanoid(landmarks)` of ../humanoid written out: the vitecache plugin
 * rigs him ahead, in Node, for a load it reads as it is written.
 */
export const rig = () =>
  new CachedRigLoader(rigging.manager, rigging.cache).loadAsync({
    url: '/models/player.glb',
    resolution: 512,
    skeleton: [
      { name: 'hips', position: [0, 0.95, -0.01] },
      { name: 'spine', parent: 'hips', position: [0, 1.08, -0.005] },
      { name: 'chest', parent: 'spine', position: [0, 1.28, -0.01] },
      { name: 'neck', parent: 'chest', position: [0, 1.63, -0.05] },
      { name: 'head', parent: 'neck', position: [0, 1.71, -0.02] },
      { name: 'head_end', parent: 'head', position: [0, 1.94, -0.005] },
      { name: 'leftShoulder', parent: 'chest', position: [0.04, 1.56, -0.05] },
      { name: 'leftUpperArm', parent: 'leftShoulder', position: [0.2, 1.56, -0.057] },
      { name: 'leftLowerArm', parent: 'leftUpperArm', position: [0.49, 1.534, -0.054] },
      { name: 'leftHand', parent: 'leftLowerArm', position: [0.755, 1.525, 0.013] },
      { name: 'leftMiddleProximal', parent: 'leftHand', position: [0.875, 1.514, 0.055] },
      { name: 'leftMiddleIntermediate', parent: 'leftMiddleProximal', position: [0.921, 1.51, 0.071] },
      { name: 'leftMiddleDistal', parent: 'leftMiddleIntermediate', position: [0.95, 1.507, 0.081] },
      { name: 'leftMiddleDistal_end', parent: 'leftMiddleDistal', position: [0.973, 1.505, 0.089] },
      { name: 'leftIndexProximal', parent: 'leftHand', position: [0.863, 1.523, 0.074] },
      { name: 'leftIndexIntermediate', parent: 'leftIndexProximal', position: [0.905, 1.523, 0.097] },
      { name: 'leftIndexDistal', parent: 'leftIndexIntermediate', position: [0.932, 1.522, 0.112] },
      { name: 'leftIndexDistal_end', parent: 'leftIndexDistal', position: [0.952, 1.522, 0.123] },
      { name: 'leftRingProximal', parent: 'leftHand', position: [0.868, 1.504, 0.033] },
      { name: 'leftRingIntermediate', parent: 'leftRingProximal', position: [0.912, 1.495, 0.041] },
      { name: 'leftRingDistal', parent: 'leftRingIntermediate', position: [0.94, 1.49, 0.046] },
      { name: 'leftRingDistal_end', parent: 'leftRingDistal', position: [0.961, 1.486, 0.05] },
      { name: 'leftLittleProximal', parent: 'leftHand', position: [0.852, 1.497, 0.011] },
      { name: 'leftLittleIntermediate', parent: 'leftLittleProximal', position: [0.894, 1.485, 0.01] },
      { name: 'leftLittleDistal', parent: 'leftLittleIntermediate', position: [0.92, 1.478, 0.009] },
      { name: 'leftLittleDistal_end', parent: 'leftLittleDistal', position: [0.941, 1.472, 0.009] },
      { name: 'leftThumbMetacarpal', parent: 'leftHand', position: [0.78, 1.5, 0.045] },
      { name: 'leftThumbProximal', parent: 'leftThumbMetacarpal', position: [0.816, 1.486, 0.084] },
      { name: 'leftThumbDistal', parent: 'leftThumbProximal', position: [0.844, 1.475, 0.115] },
      { name: 'leftThumbDistal_end', parent: 'leftThumbDistal', position: [0.866, 1.466, 0.139] },
      { name: 'leftUpperLeg', parent: 'hips', position: [0.1, 0.93, -0.005] },
      { name: 'leftLowerLeg', parent: 'leftUpperLeg', position: [0.166, 0.545, -0.045] },
      { name: 'leftFoot', parent: 'leftLowerLeg', position: [0.21, 0.11, -0.075] },
      { name: 'leftToes', parent: 'leftFoot', position: [0.228, 0.035, 0.07] },
      { name: 'leftToes_end', parent: 'leftToes', position: [0.235, 0.03, 0.16] },
      { name: 'rightShoulder', parent: 'chest', position: [-0.04, 1.56, -0.05] },
      { name: 'rightUpperArm', parent: 'rightShoulder', position: [-0.2, 1.56, -0.057] },
      { name: 'rightLowerArm', parent: 'rightUpperArm', position: [-0.49, 1.534, -0.054] },
      { name: 'rightHand', parent: 'rightLowerArm', position: [-0.755, 1.525, 0.013] },
      { name: 'rightMiddleProximal', parent: 'rightHand', position: [-0.875, 1.514, 0.055] },
      { name: 'rightMiddleIntermediate', parent: 'rightMiddleProximal', position: [-0.921, 1.51, 0.071] },
      { name: 'rightMiddleDistal', parent: 'rightMiddleIntermediate', position: [-0.95, 1.507, 0.081] },
      { name: 'rightMiddleDistal_end', parent: 'rightMiddleDistal', position: [-0.973, 1.505, 0.089] },
      { name: 'rightIndexProximal', parent: 'rightHand', position: [-0.863, 1.523, 0.074] },
      { name: 'rightIndexIntermediate', parent: 'rightIndexProximal', position: [-0.905, 1.523, 0.097] },
      { name: 'rightIndexDistal', parent: 'rightIndexIntermediate', position: [-0.932, 1.522, 0.112] },
      { name: 'rightIndexDistal_end', parent: 'rightIndexDistal', position: [-0.952, 1.522, 0.123] },
      { name: 'rightRingProximal', parent: 'rightHand', position: [-0.868, 1.504, 0.033] },
      { name: 'rightRingIntermediate', parent: 'rightRingProximal', position: [-0.912, 1.495, 0.041] },
      { name: 'rightRingDistal', parent: 'rightRingIntermediate', position: [-0.94, 1.49, 0.046] },
      { name: 'rightRingDistal_end', parent: 'rightRingDistal', position: [-0.961, 1.486, 0.05] },
      { name: 'rightLittleProximal', parent: 'rightHand', position: [-0.852, 1.497, 0.011] },
      { name: 'rightLittleIntermediate', parent: 'rightLittleProximal', position: [-0.894, 1.485, 0.01] },
      { name: 'rightLittleDistal', parent: 'rightLittleIntermediate', position: [-0.92, 1.478, 0.009] },
      { name: 'rightLittleDistal_end', parent: 'rightLittleDistal', position: [-0.941, 1.472, 0.009] },
      { name: 'rightThumbMetacarpal', parent: 'rightHand', position: [-0.78, 1.5, 0.045] },
      { name: 'rightThumbProximal', parent: 'rightThumbMetacarpal', position: [-0.816, 1.486, 0.084] },
      { name: 'rightThumbDistal', parent: 'rightThumbProximal', position: [-0.844, 1.475, 0.115] },
      { name: 'rightThumbDistal_end', parent: 'rightThumbDistal', position: [-0.866, 1.466, 0.139] },
      { name: 'rightUpperLeg', parent: 'hips', position: [-0.1, 0.93, -0.005] },
      { name: 'rightLowerLeg', parent: 'rightUpperLeg', position: [-0.166, 0.545, -0.045] },
      { name: 'rightFoot', parent: 'rightLowerLeg', position: [-0.21, 0.11, -0.075] },
      { name: 'rightToes', parent: 'rightFoot', position: [-0.228, 0.035, 0.07] },
      { name: 'rightToes_end', parent: 'rightToes', position: [-0.235, 0.03, 0.16] },
    ],
  })
