import { CachedRigLoader } from '@drawcall/rig'
import type { Landmarks } from '../humanoid'

/**
 * Where the worker's joints are, measured on his model (public/models/worker.glb) by cross-sections of its solid (m):
 * standing on y = 0 with his arms out and palms down, facing +z, his left at +x. He is 1.75 m to his crown, in a
 * T-shirt, a high-visibility vest, cargo trousers and safety boots; his arms nearly level, his hands turned a little
 * ahead, the fingers spread with the index lower and the thumb under it; both sides measured alike, so the right is the
 * left mirrored.
 */
export const landmarks: Landmarks = {
  hips: [0, 0.88, 0],
  spine: [0, 1.01, 0],
  chest: [0, 1.2, -0.01],
  neck: [0, 1.495, -0.04],
  head: [0, 1.56, 0.005],
  crown: [0, 1.735, 0.015],
  left: {
    shoulder: [0.04, 1.38, -0.05],
    arm: [0.2, 1.383, -0.062],
    elbow: [0.44, 1.372, -0.067],
    wrist: [0.685, 1.36, 0],
    thumb: [0.715, 1.34, 0.04],
    tips: {
      thumb: [0.77, 1.305, 0.108],
      index: [0.846, 1.333, 0.092],
      middle: [0.871, 1.354, 0.066],
      ring: [0.861, 1.364, 0.028],
      little: [0.848, 1.367, -0.007],
    },
    hip: [0.095, 0.86, 0],
    knee: [0.143, 0.48, -0.018],
    ankle: [0.18, 0.1, -0.045],
    ball: [0.2, 0.035, 0.081],
    toe: [0.205, 0.03, 0.155],
  },
}

/**
 * The worker rigged to his skeleton, which is `humanoid(landmarks)` of ../humanoid written out: the vitecache plugin
 * rigs him ahead, in Node, for a load it reads as it is written.
 */
export const rig = () =>
  new CachedRigLoader().loadAsync({
    url: '/models/worker.glb',
    resolution: 512,
    skeleton: [
      { name: 'hips', position: [0, 0.88, 0] },
      { name: 'spine', parent: 'hips', position: [0, 1.01, 0] },
      { name: 'chest', parent: 'spine', position: [0, 1.2, -0.01] },
      { name: 'neck', parent: 'chest', position: [0, 1.495, -0.04] },
      { name: 'head', parent: 'neck', position: [0, 1.56, 0.005] },
      { name: 'head_end', parent: 'head', position: [0, 1.735, 0.015] },
      { name: 'leftShoulder', parent: 'chest', position: [0.04, 1.38, -0.05] },
      { name: 'leftUpperArm', parent: 'leftShoulder', position: [0.2, 1.383, -0.062] },
      { name: 'leftLowerArm', parent: 'leftUpperArm', position: [0.44, 1.372, -0.067] },
      { name: 'leftHand', parent: 'leftLowerArm', position: [0.685, 1.36, 0] },
      { name: 'leftMiddleProximal', parent: 'leftHand', position: [0.787, 1.357, 0.036] },
      { name: 'leftMiddleIntermediate', parent: 'leftMiddleProximal', position: [0.827, 1.355, 0.05] },
      { name: 'leftMiddleDistal', parent: 'leftMiddleIntermediate', position: [0.852, 1.355, 0.059] },
      { name: 'leftMiddleDistal_end', parent: 'leftMiddleDistal', position: [0.871, 1.354, 0.066] },
      { name: 'leftIndexProximal', parent: 'leftHand', position: [0.774, 1.345, 0.051] },
      { name: 'leftIndexIntermediate', parent: 'leftIndexProximal', position: [0.808, 1.339, 0.07] },
      { name: 'leftIndexDistal', parent: 'leftIndexIntermediate', position: [0.829, 1.336, 0.082] },
      { name: 'leftIndexDistal_end', parent: 'leftIndexDistal', position: [0.846, 1.333, 0.092] },
      { name: 'leftRingProximal', parent: 'leftHand', position: [0.782, 1.362, 0.015] },
      { name: 'leftRingIntermediate', parent: 'leftRingProximal', position: [0.819, 1.363, 0.021] },
      { name: 'leftRingDistal', parent: 'leftRingIntermediate', position: [0.843, 1.364, 0.025] },
      { name: 'leftRingDistal_end', parent: 'leftRingDistal', position: [0.861, 1.364, 0.028] },
      { name: 'leftLittleProximal', parent: 'leftHand', position: [0.77, 1.364, -0.004] },
      { name: 'leftLittleIntermediate', parent: 'leftLittleProximal', position: [0.807, 1.365, -0.005] },
      { name: 'leftLittleDistal', parent: 'leftLittleIntermediate', position: [0.83, 1.366, -0.006] },
      { name: 'leftLittleDistal_end', parent: 'leftLittleDistal', position: [0.848, 1.367, -0.007] },
      { name: 'leftThumbMetacarpal', parent: 'leftHand', position: [0.715, 1.34, 0.04] },
      { name: 'leftThumbProximal', parent: 'leftThumbMetacarpal', position: [0.738, 1.325, 0.069] },
      { name: 'leftThumbDistal', parent: 'leftThumbProximal', position: [0.756, 1.314, 0.09] },
      { name: 'leftThumbDistal_end', parent: 'leftThumbDistal', position: [0.77, 1.305, 0.108] },
      { name: 'leftUpperLeg', parent: 'hips', position: [0.095, 0.86, 0] },
      { name: 'leftLowerLeg', parent: 'leftUpperLeg', position: [0.143, 0.48, -0.018] },
      { name: 'leftFoot', parent: 'leftLowerLeg', position: [0.18, 0.1, -0.045] },
      { name: 'leftToes', parent: 'leftFoot', position: [0.2, 0.035, 0.081] },
      { name: 'leftToes_end', parent: 'leftToes', position: [0.205, 0.03, 0.155] },
      { name: 'rightShoulder', parent: 'chest', position: [-0.04, 1.38, -0.05] },
      { name: 'rightUpperArm', parent: 'rightShoulder', position: [-0.2, 1.383, -0.062] },
      { name: 'rightLowerArm', parent: 'rightUpperArm', position: [-0.44, 1.372, -0.067] },
      { name: 'rightHand', parent: 'rightLowerArm', position: [-0.685, 1.36, 0] },
      { name: 'rightMiddleProximal', parent: 'rightHand', position: [-0.787, 1.357, 0.036] },
      { name: 'rightMiddleIntermediate', parent: 'rightMiddleProximal', position: [-0.827, 1.355, 0.05] },
      { name: 'rightMiddleDistal', parent: 'rightMiddleIntermediate', position: [-0.852, 1.355, 0.059] },
      { name: 'rightMiddleDistal_end', parent: 'rightMiddleDistal', position: [-0.871, 1.354, 0.066] },
      { name: 'rightIndexProximal', parent: 'rightHand', position: [-0.774, 1.345, 0.051] },
      { name: 'rightIndexIntermediate', parent: 'rightIndexProximal', position: [-0.808, 1.339, 0.07] },
      { name: 'rightIndexDistal', parent: 'rightIndexIntermediate', position: [-0.829, 1.336, 0.082] },
      { name: 'rightIndexDistal_end', parent: 'rightIndexDistal', position: [-0.846, 1.333, 0.092] },
      { name: 'rightRingProximal', parent: 'rightHand', position: [-0.782, 1.362, 0.015] },
      { name: 'rightRingIntermediate', parent: 'rightRingProximal', position: [-0.819, 1.363, 0.021] },
      { name: 'rightRingDistal', parent: 'rightRingIntermediate', position: [-0.843, 1.364, 0.025] },
      { name: 'rightRingDistal_end', parent: 'rightRingDistal', position: [-0.861, 1.364, 0.028] },
      { name: 'rightLittleProximal', parent: 'rightHand', position: [-0.77, 1.364, -0.004] },
      { name: 'rightLittleIntermediate', parent: 'rightLittleProximal', position: [-0.807, 1.365, -0.005] },
      { name: 'rightLittleDistal', parent: 'rightLittleIntermediate', position: [-0.83, 1.366, -0.006] },
      { name: 'rightLittleDistal_end', parent: 'rightLittleDistal', position: [-0.848, 1.367, -0.007] },
      { name: 'rightThumbMetacarpal', parent: 'rightHand', position: [-0.715, 1.34, 0.04] },
      { name: 'rightThumbProximal', parent: 'rightThumbMetacarpal', position: [-0.738, 1.325, 0.069] },
      { name: 'rightThumbDistal', parent: 'rightThumbProximal', position: [-0.756, 1.314, 0.09] },
      { name: 'rightThumbDistal_end', parent: 'rightThumbDistal', position: [-0.77, 1.305, 0.108] },
      { name: 'rightUpperLeg', parent: 'hips', position: [-0.095, 0.86, 0] },
      { name: 'rightLowerLeg', parent: 'rightUpperLeg', position: [-0.143, 0.48, -0.018] },
      { name: 'rightFoot', parent: 'rightLowerLeg', position: [-0.18, 0.1, -0.045] },
      { name: 'rightToes', parent: 'rightFoot', position: [-0.2, 0.035, 0.081] },
      { name: 'rightToes_end', parent: 'rightToes', position: [-0.205, 0.03, 0.155] },
    ],
  })
