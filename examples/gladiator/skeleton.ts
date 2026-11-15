import { CachedRigLoader } from '@drawcall/rig'
import type { Landmarks } from '../humanoid'

/**
 * Where the legionary's joints are, measured on his model (public/models/gladiator.glb) by cross-sections of its solid
 * (m): standing on y = 0 with his arms out and palms down, facing +z, his left at +x. He is 1.76 m to the top of his
 * helmet, his arms sloping a little down to his hands at about 1.35 m with the fingers spread a little and the thumb
 * ahead and below; his tunic joins his legs up to its hem at 0.67 m, so his hip joints are set where a man's are, not
 * where the solid parts; both sides measured alike, so the right is the left mirrored.
 */
export const landmarks: Landmarks = {
  hips: [0, 0.88, 0.0],
  spine: [0, 0.975, 0.0],
  chest: [0, 1.155, -0.005],
  neck: [0, 1.475, -0.035],
  head: [0, 1.545, -0.01],
  crown: [0, 1.755, 0.015],
  left: {
    shoulder: [0.04, 1.39, -0.035],
    arm: [0.19, 1.385, -0.035],
    elbow: [0.44, 1.374, -0.056],
    wrist: [0.67, 1.37, -0.01],
    thumb: [0.715, 1.345, 0.035],
    tips: {
      thumb: [0.772, 1.318, 0.104],
      index: [0.86, 1.348, 0.058],
      middle: [0.879, 1.352, 0.031],
      ring: [0.87, 1.352, 0.001],
      little: [0.84, 1.35, -0.028],
    },
    hip: [0.095, 0.86, 0.0],
    knee: [0.14, 0.505, -0.013],
    ankle: [0.185, 0.09, -0.03],
    ball: [0.196, 0.03, 0.105],
    toe: [0.2, 0.025, 0.175],
  },
}

/**
 * The legionary rigged to his skeleton, which is `humanoid(landmarks)` of ../humanoid written out: the vitecache plugin
 * rigs him ahead, in Node, for a load it reads as it is written.
 */
export const rig = () =>
  new CachedRigLoader().loadAsync({
    url: '/models/gladiator.glb',
    resolution: 512,
    skeleton: [
      { name: 'hips', position: [0, 0.88, 0] },
      { name: 'spine', parent: 'hips', position: [0, 0.975, 0] },
      { name: 'chest', parent: 'spine', position: [0, 1.155, -0.005] },
      { name: 'neck', parent: 'chest', position: [0, 1.475, -0.035] },
      { name: 'head', parent: 'neck', position: [0, 1.545, -0.01] },
      { name: 'head_end', parent: 'head', position: [0, 1.755, 0.015] },
      { name: 'leftShoulder', parent: 'chest', position: [0.04, 1.39, -0.035] },
      { name: 'leftUpperArm', parent: 'leftShoulder', position: [0.19, 1.385, -0.035] },
      { name: 'leftLowerArm', parent: 'leftUpperArm', position: [0.44, 1.374, -0.056] },
      { name: 'leftHand', parent: 'leftLowerArm', position: [0.67, 1.37, -0.01] },
      { name: 'leftMiddleProximal', parent: 'leftHand', position: [0.785, 1.36, 0.013] },
      { name: 'leftMiddleIntermediate', parent: 'leftMiddleProximal', position: [0.829, 1.356, 0.021] },
      { name: 'leftMiddleDistal', parent: 'leftMiddleIntermediate', position: [0.857, 1.354, 0.027] },
      { name: 'leftMiddleDistal_end', parent: 'leftMiddleDistal', position: [0.879, 1.352, 0.031] },
      { name: 'leftIndexProximal', parent: 'leftHand', position: [0.775, 1.358, 0.027] },
      { name: 'leftIndexIntermediate', parent: 'leftIndexProximal', position: [0.815, 1.353, 0.042] },
      { name: 'leftIndexDistal', parent: 'leftIndexIntermediate', position: [0.84, 1.35, 0.051] },
      { name: 'leftIndexDistal_end', parent: 'leftIndexDistal', position: [0.86, 1.348, 0.058] },
      { name: 'leftRingProximal', parent: 'leftHand', position: [0.78, 1.36, -0.004] },
      { name: 'leftRingIntermediate', parent: 'leftRingProximal', position: [0.822, 1.356, -0.002] },
      { name: 'leftRingDistal', parent: 'leftRingIntermediate', position: [0.849, 1.354, 0] },
      { name: 'leftRingDistal_end', parent: 'leftRingDistal', position: [0.87, 1.352, 0.001] },
      { name: 'leftLittleProximal', parent: 'leftHand', position: [0.758, 1.36, -0.019] },
      { name: 'leftLittleIntermediate', parent: 'leftLittleProximal', position: [0.797, 1.355, -0.023] },
      { name: 'leftLittleDistal', parent: 'leftLittleIntermediate', position: [0.821, 1.352, -0.026] },
      { name: 'leftLittleDistal_end', parent: 'leftLittleDistal', position: [0.84, 1.35, -0.028] },
      { name: 'leftThumbMetacarpal', parent: 'leftHand', position: [0.715, 1.345, 0.035] },
      { name: 'leftThumbProximal', parent: 'leftThumbMetacarpal', position: [0.739, 1.334, 0.064] },
      { name: 'leftThumbDistal', parent: 'leftThumbProximal', position: [0.757, 1.325, 0.086] },
      { name: 'leftThumbDistal_end', parent: 'leftThumbDistal', position: [0.772, 1.318, 0.104] },
      { name: 'leftUpperLeg', parent: 'hips', position: [0.095, 0.86, 0] },
      { name: 'leftLowerLeg', parent: 'leftUpperLeg', position: [0.14, 0.505, -0.013] },
      { name: 'leftFoot', parent: 'leftLowerLeg', position: [0.185, 0.09, -0.03] },
      { name: 'leftToes', parent: 'leftFoot', position: [0.196, 0.03, 0.105] },
      { name: 'leftToes_end', parent: 'leftToes', position: [0.2, 0.025, 0.175] },
      { name: 'rightShoulder', parent: 'chest', position: [-0.04, 1.39, -0.035] },
      { name: 'rightUpperArm', parent: 'rightShoulder', position: [-0.19, 1.385, -0.035] },
      { name: 'rightLowerArm', parent: 'rightUpperArm', position: [-0.44, 1.374, -0.056] },
      { name: 'rightHand', parent: 'rightLowerArm', position: [-0.67, 1.37, -0.01] },
      { name: 'rightMiddleProximal', parent: 'rightHand', position: [-0.785, 1.36, 0.013] },
      { name: 'rightMiddleIntermediate', parent: 'rightMiddleProximal', position: [-0.829, 1.356, 0.021] },
      { name: 'rightMiddleDistal', parent: 'rightMiddleIntermediate', position: [-0.857, 1.354, 0.027] },
      { name: 'rightMiddleDistal_end', parent: 'rightMiddleDistal', position: [-0.879, 1.352, 0.031] },
      { name: 'rightIndexProximal', parent: 'rightHand', position: [-0.774, 1.358, 0.027] },
      { name: 'rightIndexIntermediate', parent: 'rightIndexProximal', position: [-0.815, 1.353, 0.042] },
      { name: 'rightIndexDistal', parent: 'rightIndexIntermediate', position: [-0.84, 1.35, 0.051] },
      { name: 'rightIndexDistal_end', parent: 'rightIndexDistal', position: [-0.86, 1.348, 0.058] },
      { name: 'rightRingProximal', parent: 'rightHand', position: [-0.78, 1.36, -0.004] },
      { name: 'rightRingIntermediate', parent: 'rightRingProximal', position: [-0.822, 1.356, -0.002] },
      { name: 'rightRingDistal', parent: 'rightRingIntermediate', position: [-0.849, 1.354, 0] },
      { name: 'rightRingDistal_end', parent: 'rightRingDistal', position: [-0.87, 1.352, 0.001] },
      { name: 'rightLittleProximal', parent: 'rightHand', position: [-0.758, 1.36, -0.019] },
      { name: 'rightLittleIntermediate', parent: 'rightLittleProximal', position: [-0.797, 1.355, -0.023] },
      { name: 'rightLittleDistal', parent: 'rightLittleIntermediate', position: [-0.821, 1.352, -0.026] },
      { name: 'rightLittleDistal_end', parent: 'rightLittleDistal', position: [-0.84, 1.35, -0.028] },
      { name: 'rightThumbMetacarpal', parent: 'rightHand', position: [-0.715, 1.345, 0.035] },
      { name: 'rightThumbProximal', parent: 'rightThumbMetacarpal', position: [-0.739, 1.334, 0.064] },
      { name: 'rightThumbDistal', parent: 'rightThumbProximal', position: [-0.757, 1.325, 0.086] },
      { name: 'rightThumbDistal_end', parent: 'rightThumbDistal', position: [-0.772, 1.318, 0.104] },
      { name: 'rightUpperLeg', parent: 'hips', position: [-0.095, 0.86, 0] },
      { name: 'rightLowerLeg', parent: 'rightUpperLeg', position: [-0.14, 0.505, -0.013] },
      { name: 'rightFoot', parent: 'rightLowerLeg', position: [-0.185, 0.09, -0.03] },
      { name: 'rightToes', parent: 'rightFoot', position: [-0.196, 0.03, 0.105] },
      { name: 'rightToes_end', parent: 'rightToes', position: [-0.2, 0.025, 0.175] },
    ],
  })
