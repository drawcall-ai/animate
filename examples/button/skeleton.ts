import { CachedRigLoader } from '@drawcall/rig'
import type { Landmarks } from '../humanoid'

/**
 * Where the walker's joints are, measured on his model (public/models/walker.glb) by cross-sections of its solid (m):
 * standing on y = 0 with his arms out and palms down, facing +z, his left at +x. He is 1.78 m to his crown, in a
 * hoodie whose hood lies on his back, jeans and trainers; his arms nearly level, his fingers spread with the index a
 * little lower and the thumb out ahead under it; both sides measured alike, so the right is the left mirrored.
 */
export const landmarks: Landmarks = {
  hips: [0, 0.9, 0],
  spine: [0, 1.02, 0.01],
  chest: [0, 1.2, 0],
  neck: [0, 1.49, -0.025],
  head: [0, 1.57, 0.01],
  crown: [0, 1.77, 0.03],
  left: {
    shoulder: [0.04, 1.39, -0.04],
    arm: [0.19, 1.392, -0.034],
    elbow: [0.45, 1.389, -0.041],
    wrist: [0.69, 1.378, 0],
    thumb: [0.72, 1.355, 0.035],
    tips: {
      thumb: [0.778, 1.315, 0.11],
      index: [0.86, 1.347, 0.079],
      middle: [0.881, 1.38, 0.051],
      ring: [0.879, 1.384, 0.006],
      little: [0.86, 1.382, -0.035],
    },
    hip: [0.095, 0.88, 0],
    knee: [0.143, 0.51, 0.01],
    ankle: [0.185, 0.09, -0.04],
    ball: [0.205, 0.035, 0.096],
    toe: [0.21, 0.03, 0.165],
  },
}

/**
 * The walker rigged to his skeleton, which is `humanoid(landmarks)` of ../humanoid written out: the vitecache plugin
 * rigs him ahead, in Node, for a load it reads as it is written.
 */
export const rig = () =>
  new CachedRigLoader().loadAsync({
    url: '/models/walker.glb',
    resolution: 512,
    skeleton: [
      { name: 'hips', position: [0, 0.9, 0] },
      { name: 'spine', parent: 'hips', position: [0, 1.02, 0.01] },
      { name: 'chest', parent: 'spine', position: [0, 1.2, 0] },
      { name: 'neck', parent: 'chest', position: [0, 1.49, -0.025] },
      { name: 'head', parent: 'neck', position: [0, 1.57, 0.01] },
      { name: 'head_end', parent: 'head', position: [0, 1.77, 0.03] },
      { name: 'leftShoulder', parent: 'chest', position: [0.04, 1.39, -0.04] },
      { name: 'leftUpperArm', parent: 'leftShoulder', position: [0.19, 1.392, -0.034] },
      { name: 'leftLowerArm', parent: 'leftUpperArm', position: [0.45, 1.389, -0.041] },
      { name: 'leftHand', parent: 'leftLowerArm', position: [0.69, 1.378, 0] },
      { name: 'leftMiddleProximal', parent: 'leftHand', position: [0.795, 1.379, 0.028] },
      { name: 'leftMiddleIntermediate', parent: 'leftMiddleProximal', position: [0.835, 1.38, 0.039] },
      { name: 'leftMiddleDistal', parent: 'leftMiddleIntermediate', position: [0.861, 1.38, 0.046] },
      { name: 'leftMiddleDistal_end', parent: 'leftMiddleDistal', position: [0.881, 1.38, 0.051] },
      { name: 'leftIndexProximal', parent: 'leftHand', position: [0.784, 1.361, 0.043] },
      { name: 'leftIndexIntermediate', parent: 'leftIndexProximal', position: [0.819, 1.354, 0.06] },
      { name: 'leftIndexDistal', parent: 'leftIndexIntermediate', position: [0.842, 1.35, 0.071] },
      { name: 'leftIndexDistal_end', parent: 'leftIndexDistal', position: [0.86, 1.347, 0.079] },
      { name: 'leftRingProximal', parent: 'leftHand', position: [0.794, 1.381, 0.003] },
      { name: 'leftRingIntermediate', parent: 'leftRingProximal', position: [0.834, 1.383, 0.005] },
      { name: 'leftRingDistal', parent: 'leftRingIntermediate', position: [0.859, 1.383, 0.005] },
      { name: 'leftRingDistal_end', parent: 'leftRingDistal', position: [0.879, 1.384, 0.006] },
      { name: 'leftLittleProximal', parent: 'leftHand', position: [0.778, 1.38, -0.018] },
      { name: 'leftLittleIntermediate', parent: 'leftLittleProximal', position: [0.817, 1.381, -0.026] },
      { name: 'leftLittleDistal', parent: 'leftLittleIntermediate', position: [0.841, 1.382, -0.031] },
      { name: 'leftLittleDistal_end', parent: 'leftLittleDistal', position: [0.86, 1.382, -0.035] },
      { name: 'leftThumbMetacarpal', parent: 'leftHand', position: [0.72, 1.355, 0.035] },
      { name: 'leftThumbProximal', parent: 'leftThumbMetacarpal', position: [0.744, 1.338, 0.067] },
      { name: 'leftThumbDistal', parent: 'leftThumbProximal', position: [0.763, 1.325, 0.091] },
      { name: 'leftThumbDistal_end', parent: 'leftThumbDistal', position: [0.778, 1.315, 0.11] },
      { name: 'leftUpperLeg', parent: 'hips', position: [0.095, 0.88, 0] },
      { name: 'leftLowerLeg', parent: 'leftUpperLeg', position: [0.143, 0.51, 0.01] },
      { name: 'leftFoot', parent: 'leftLowerLeg', position: [0.185, 0.09, -0.04] },
      { name: 'leftToes', parent: 'leftFoot', position: [0.205, 0.035, 0.096] },
      { name: 'leftToes_end', parent: 'leftToes', position: [0.21, 0.03, 0.165] },
      { name: 'rightShoulder', parent: 'chest', position: [-0.04, 1.39, -0.04] },
      { name: 'rightUpperArm', parent: 'rightShoulder', position: [-0.19, 1.392, -0.034] },
      { name: 'rightLowerArm', parent: 'rightUpperArm', position: [-0.45, 1.389, -0.041] },
      { name: 'rightHand', parent: 'rightLowerArm', position: [-0.69, 1.378, 0] },
      { name: 'rightMiddleProximal', parent: 'rightHand', position: [-0.795, 1.379, 0.028] },
      { name: 'rightMiddleIntermediate', parent: 'rightMiddleProximal', position: [-0.835, 1.38, 0.039] },
      { name: 'rightMiddleDistal', parent: 'rightMiddleIntermediate', position: [-0.861, 1.38, 0.046] },
      { name: 'rightMiddleDistal_end', parent: 'rightMiddleDistal', position: [-0.881, 1.38, 0.051] },
      { name: 'rightIndexProximal', parent: 'rightHand', position: [-0.783, 1.361, 0.043] },
      { name: 'rightIndexIntermediate', parent: 'rightIndexProximal', position: [-0.819, 1.354, 0.06] },
      { name: 'rightIndexDistal', parent: 'rightIndexIntermediate', position: [-0.842, 1.35, 0.071] },
      { name: 'rightIndexDistal_end', parent: 'rightIndexDistal', position: [-0.86, 1.347, 0.079] },
      { name: 'rightRingProximal', parent: 'rightHand', position: [-0.794, 1.381, 0.003] },
      { name: 'rightRingIntermediate', parent: 'rightRingProximal', position: [-0.834, 1.383, 0.005] },
      { name: 'rightRingDistal', parent: 'rightRingIntermediate', position: [-0.859, 1.383, 0.005] },
      { name: 'rightRingDistal_end', parent: 'rightRingDistal', position: [-0.879, 1.384, 0.006] },
      { name: 'rightLittleProximal', parent: 'rightHand', position: [-0.778, 1.38, -0.018] },
      { name: 'rightLittleIntermediate', parent: 'rightLittleProximal', position: [-0.817, 1.381, -0.026] },
      { name: 'rightLittleDistal', parent: 'rightLittleIntermediate', position: [-0.841, 1.382, -0.031] },
      { name: 'rightLittleDistal_end', parent: 'rightLittleDistal', position: [-0.86, 1.382, -0.035] },
      { name: 'rightThumbMetacarpal', parent: 'rightHand', position: [-0.72, 1.355, 0.035] },
      { name: 'rightThumbProximal', parent: 'rightThumbMetacarpal', position: [-0.744, 1.338, 0.067] },
      { name: 'rightThumbDistal', parent: 'rightThumbProximal', position: [-0.763, 1.325, 0.091] },
      { name: 'rightThumbDistal_end', parent: 'rightThumbDistal', position: [-0.778, 1.315, 0.11] },
      { name: 'rightUpperLeg', parent: 'hips', position: [-0.095, 0.88, 0] },
      { name: 'rightLowerLeg', parent: 'rightUpperLeg', position: [-0.143, 0.51, 0.01] },
      { name: 'rightFoot', parent: 'rightLowerLeg', position: [-0.185, 0.09, -0.04] },
      { name: 'rightToes', parent: 'rightFoot', position: [-0.205, 0.035, 0.096] },
      { name: 'rightToes_end', parent: 'rightToes', position: [-0.21, 0.03, 0.165] },
    ],
  })
