import { CachedRigLoader } from '@drawcall/rig'
import type { Landmarks } from '../humanoid'

/**
 * Where the footballer's joints are, measured on his model (public/models/footballer.glb) by cross-sections of its solid
 * (m): standing on y = 0 with his arms out and palms down, facing +z, his left at +x. He is 1.80 m to his crown, his
 * arms sloping a little down from the shoulder, his legs a little apart, his fingers spread with the thumb ahead and
 * below the index; both sides measured alike, so the right is the left mirrored.
 */
export const landmarks: Landmarks = {
  hips: [0, 0.885, -0.015],
  spine: [0, 1.0, -0.01],
  chest: [0, 1.19, -0.015],
  neck: [0, 1.53, -0.035],
  head: [0, 1.6, 0.0],
  crown: [0, 1.795, 0.005],
  left: {
    shoulder: [0.035, 1.44, -0.05],
    arm: [0.185, 1.43, -0.06],
    elbow: [0.46, 1.406, -0.065],
    wrist: [0.69, 1.39, -0.02],
    thumb: [0.715, 1.37, 0.02],
    tips: {
      thumb: [0.79, 1.33, 0.077],
      index: [0.872, 1.363, 0.046],
      middle: [0.895, 1.385, 0.011],
      ring: [0.884, 1.381, -0.027],
      little: [0.86, 1.377, -0.058],
    },
    hip: [0.095, 0.875, -0.01],
    knee: [0.14, 0.56, -0.025],
    ankle: [0.196, 0.09, -0.06],
    ball: [0.215, 0.03, 0.065],
    toe: [0.22, 0.025, 0.145],
  },
}

/**
 * The footballer rigged to his skeleton, which is `humanoid(landmarks)` of ../humanoid written out: the vitecache plugin
 * rigs him ahead, in Node, for a load it reads as it is written.
 */
export const rig = () =>
  new CachedRigLoader().loadAsync({
    url: '/models/footballer.glb',
    resolution: 512,
    skeleton: [
      { name: 'hips', position: [0, 0.885, -0.015] },
      { name: 'spine', parent: 'hips', position: [0, 1, -0.01] },
      { name: 'chest', parent: 'spine', position: [0, 1.19, -0.015] },
      { name: 'neck', parent: 'chest', position: [0, 1.53, -0.035] },
      { name: 'head', parent: 'neck', position: [0, 1.6, 0] },
      { name: 'head_end', parent: 'head', position: [0, 1.795, 0.005] },
      { name: 'leftShoulder', parent: 'chest', position: [0.035, 1.44, -0.05] },
      { name: 'leftUpperArm', parent: 'leftShoulder', position: [0.185, 1.43, -0.06] },
      { name: 'leftLowerArm', parent: 'leftUpperArm', position: [0.46, 1.406, -0.065] },
      { name: 'leftHand', parent: 'leftLowerArm', position: [0.69, 1.39, -0.02] },
      { name: 'leftMiddleProximal', parent: 'leftHand', position: [0.803, 1.387, -0.003] },
      { name: 'leftMiddleIntermediate', parent: 'leftMiddleProximal', position: [0.846, 1.386, 0.004] },
      { name: 'leftMiddleDistal', parent: 'leftMiddleIntermediate', position: [0.874, 1.386, 0.008] },
      { name: 'leftMiddleDistal_end', parent: 'leftMiddleDistal', position: [0.895, 1.385, 0.011] },
      { name: 'leftIndexProximal', parent: 'leftHand', position: [0.79, 1.375, 0.016] },
      { name: 'leftIndexIntermediate', parent: 'leftIndexProximal', position: [0.829, 1.369, 0.03] },
      { name: 'leftIndexDistal', parent: 'leftIndexIntermediate', position: [0.853, 1.366, 0.039] },
      { name: 'leftIndexDistal_end', parent: 'leftIndexDistal', position: [0.872, 1.363, 0.046] },
      { name: 'leftRingProximal', parent: 'leftHand', position: [0.797, 1.385, -0.024] },
      { name: 'leftRingIntermediate', parent: 'leftRingProximal', position: [0.838, 1.383, -0.025] },
      { name: 'leftRingDistal', parent: 'leftRingIntermediate', position: [0.864, 1.382, -0.026] },
      { name: 'leftRingDistal_end', parent: 'leftRingDistal', position: [0.884, 1.381, -0.027] },
      { name: 'leftLittleProximal', parent: 'leftHand', position: [0.778, 1.383, -0.04] },
      { name: 'leftLittleIntermediate', parent: 'leftLittleProximal', position: [0.817, 1.38, -0.048] },
      { name: 'leftLittleDistal', parent: 'leftLittleIntermediate', position: [0.841, 1.378, -0.054] },
      { name: 'leftLittleDistal_end', parent: 'leftLittleDistal', position: [0.86, 1.377, -0.058] },
      { name: 'leftThumbMetacarpal', parent: 'leftHand', position: [0.715, 1.37, 0.02] },
      { name: 'leftThumbProximal', parent: 'leftThumbMetacarpal', position: [0.746, 1.353, 0.044] },
      { name: 'leftThumbDistal', parent: 'leftThumbProximal', position: [0.771, 1.34, 0.062] },
      { name: 'leftThumbDistal_end', parent: 'leftThumbDistal', position: [0.79, 1.33, 0.077] },
      { name: 'leftUpperLeg', parent: 'hips', position: [0.095, 0.875, -0.01] },
      { name: 'leftLowerLeg', parent: 'leftUpperLeg', position: [0.14, 0.56, -0.025] },
      { name: 'leftFoot', parent: 'leftLowerLeg', position: [0.196, 0.09, -0.06] },
      { name: 'leftToes', parent: 'leftFoot', position: [0.215, 0.03, 0.065] },
      { name: 'leftToes_end', parent: 'leftToes', position: [0.22, 0.025, 0.145] },
      { name: 'rightShoulder', parent: 'chest', position: [-0.035, 1.44, -0.05] },
      { name: 'rightUpperArm', parent: 'rightShoulder', position: [-0.185, 1.43, -0.06] },
      { name: 'rightLowerArm', parent: 'rightUpperArm', position: [-0.46, 1.406, -0.065] },
      { name: 'rightHand', parent: 'rightLowerArm', position: [-0.69, 1.39, -0.02] },
      { name: 'rightMiddleProximal', parent: 'rightHand', position: [-0.803, 1.387, -0.003] },
      { name: 'rightMiddleIntermediate', parent: 'rightMiddleProximal', position: [-0.846, 1.386, 0.004] },
      { name: 'rightMiddleDistal', parent: 'rightMiddleIntermediate', position: [-0.874, 1.386, 0.008] },
      { name: 'rightMiddleDistal_end', parent: 'rightMiddleDistal', position: [-0.895, 1.385, 0.011] },
      { name: 'rightIndexProximal', parent: 'rightHand', position: [-0.79, 1.375, 0.016] },
      { name: 'rightIndexIntermediate', parent: 'rightIndexProximal', position: [-0.829, 1.369, 0.03] },
      { name: 'rightIndexDistal', parent: 'rightIndexIntermediate', position: [-0.853, 1.366, 0.039] },
      { name: 'rightIndexDistal_end', parent: 'rightIndexDistal', position: [-0.872, 1.363, 0.046] },
      { name: 'rightRingProximal', parent: 'rightHand', position: [-0.797, 1.385, -0.024] },
      { name: 'rightRingIntermediate', parent: 'rightRingProximal', position: [-0.838, 1.383, -0.025] },
      { name: 'rightRingDistal', parent: 'rightRingIntermediate', position: [-0.864, 1.382, -0.026] },
      { name: 'rightRingDistal_end', parent: 'rightRingDistal', position: [-0.884, 1.381, -0.027] },
      { name: 'rightLittleProximal', parent: 'rightHand', position: [-0.778, 1.383, -0.04] },
      { name: 'rightLittleIntermediate', parent: 'rightLittleProximal', position: [-0.817, 1.38, -0.048] },
      { name: 'rightLittleDistal', parent: 'rightLittleIntermediate', position: [-0.841, 1.378, -0.054] },
      { name: 'rightLittleDistal_end', parent: 'rightLittleDistal', position: [-0.86, 1.377, -0.058] },
      { name: 'rightThumbMetacarpal', parent: 'rightHand', position: [-0.715, 1.37, 0.02] },
      { name: 'rightThumbProximal', parent: 'rightThumbMetacarpal', position: [-0.746, 1.353, 0.044] },
      { name: 'rightThumbDistal', parent: 'rightThumbProximal', position: [-0.77, 1.34, 0.062] },
      { name: 'rightThumbDistal_end', parent: 'rightThumbDistal', position: [-0.79, 1.33, 0.077] },
      { name: 'rightUpperLeg', parent: 'hips', position: [-0.095, 0.875, -0.01] },
      { name: 'rightLowerLeg', parent: 'rightUpperLeg', position: [-0.14, 0.56, -0.025] },
      { name: 'rightFoot', parent: 'rightLowerLeg', position: [-0.196, 0.09, -0.06] },
      { name: 'rightToes', parent: 'rightFoot', position: [-0.215, 0.03, 0.065] },
      { name: 'rightToes_end', parent: 'rightToes', position: [-0.22, 0.025, 0.145] },
    ],
  })
