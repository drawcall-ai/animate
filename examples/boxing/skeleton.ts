import { CachedRigLoader } from '@drawcall/rig'
import { rigging } from '../served'
import type { Landmarks } from '../humanoid'

/**
 * Where the boxer's joints are, measured on his model (public/models/boxer.glb) by cross-sections of its solid (m):
 * standing on y = 0 with his arms out, facing +z, his left at +x. He is 1.80 m to his crown, his arms sloping a little
 * down to his hands at about 1.42 m, his hands in wraps up to the knuckles and rolled forward, so that his fingers
 * spread one above the other with the index lowest and the thumb pointing down and ahead; both sides measured alike,
 * so the right is the left mirrored.
 */
export const landmarks: Landmarks = {
  hips: [0, 0.905, 0.005],
  spine: [0, 1.0, 0.0],
  chest: [0, 1.19, 0.0],
  neck: [0, 1.5, -0.045],
  head: [0, 1.59, -0.01],
  crown: [0, 1.795, 0.0],
  left: {
    shoulder: [0.04, 1.44, -0.045],
    arm: [0.2, 1.435, -0.052],
    elbow: [0.455, 1.416, -0.051],
    wrist: [0.69, 1.418, -0.012],
    thumb: [0.725, 1.39, 0.03],
    tips: {
      thumb: [0.784, 1.332, 0.087],
      index: [0.869, 1.368, 0.059],
      middle: [0.889, 1.4, 0.039],
      ring: [0.886, 1.435, 0.017],
      little: [0.856, 1.464, -0.005],
    },
    hip: [0.1, 0.885, 0.0],
    knee: [0.168, 0.505, -0.042],
    ankle: [0.215, 0.1, -0.055],
    ball: [0.236, 0.035, 0.085],
    toe: [0.24, 0.03, 0.155],
  },
}

/**
 * The boxer rigged to his skeleton, which is `humanoid(landmarks)` of ../humanoid written out: the vitecache plugin
 * rigs him ahead, in Node, for a load it reads as it is written.
 */
export const rig = () =>
  new CachedRigLoader(rigging.manager, rigging.cache).loadAsync({
    url: '/models/boxer.glb',
    resolution: 512,
    skeleton: [
      { name: 'hips', position: [0, 0.905, 0.005] },
      { name: 'spine', parent: 'hips', position: [0, 1, 0] },
      { name: 'chest', parent: 'spine', position: [0, 1.19, 0] },
      { name: 'neck', parent: 'chest', position: [0, 1.5, -0.045] },
      { name: 'head', parent: 'neck', position: [0, 1.59, -0.01] },
      { name: 'head_end', parent: 'head', position: [0, 1.795, 0] },
      { name: 'leftShoulder', parent: 'chest', position: [0.04, 1.44, -0.045] },
      { name: 'leftUpperArm', parent: 'leftShoulder', position: [0.2, 1.435, -0.052] },
      { name: 'leftLowerArm', parent: 'leftUpperArm', position: [0.455, 1.416, -0.051] },
      { name: 'leftHand', parent: 'leftLowerArm', position: [0.69, 1.418, -0.012] },
      { name: 'leftMiddleProximal', parent: 'leftHand', position: [0.799, 1.408, 0.016] },
      { name: 'leftMiddleIntermediate', parent: 'leftMiddleProximal', position: [0.842, 1.404, 0.027] },
      { name: 'leftMiddleDistal', parent: 'leftMiddleIntermediate', position: [0.868, 1.402, 0.034] },
      { name: 'leftMiddleDistal_end', parent: 'leftMiddleDistal', position: [0.889, 1.4, 0.039] },
      { name: 'leftIndexProximal', parent: 'leftHand', position: [0.788, 1.391, 0.027] },
      { name: 'leftIndexIntermediate', parent: 'leftIndexProximal', position: [0.826, 1.38, 0.042] },
      { name: 'leftIndexDistal', parent: 'leftIndexIntermediate', position: [0.85, 1.373, 0.052] },
      { name: 'leftIndexDistal_end', parent: 'leftIndexDistal', position: [0.869, 1.368, 0.059] },
      { name: 'leftRingProximal', parent: 'leftHand', position: [0.798, 1.427, 0.004] },
      { name: 'leftRingIntermediate', parent: 'leftRingProximal', position: [0.839, 1.431, 0.01] },
      { name: 'leftRingDistal', parent: 'leftRingIntermediate', position: [0.866, 1.433, 0.014] },
      { name: 'leftRingDistal_end', parent: 'leftRingDistal', position: [0.886, 1.435, 0.017] },
      { name: 'leftLittleProximal', parent: 'leftHand', position: [0.776, 1.442, -0.008] },
      { name: 'leftLittleIntermediate', parent: 'leftLittleProximal', position: [0.814, 1.452, -0.007] },
      { name: 'leftLittleDistal', parent: 'leftLittleIntermediate', position: [0.838, 1.459, -0.006] },
      { name: 'leftLittleDistal_end', parent: 'leftLittleDistal', position: [0.856, 1.464, -0.005] },
      { name: 'leftThumbMetacarpal', parent: 'leftHand', position: [0.725, 1.39, 0.03] },
      { name: 'leftThumbProximal', parent: 'leftThumbMetacarpal', position: [0.75, 1.366, 0.054] },
      { name: 'leftThumbDistal', parent: 'leftThumbProximal', position: [0.769, 1.347, 0.072] },
      { name: 'leftThumbDistal_end', parent: 'leftThumbDistal', position: [0.784, 1.332, 0.087] },
      { name: 'leftUpperLeg', parent: 'hips', position: [0.1, 0.885, 0] },
      { name: 'leftLowerLeg', parent: 'leftUpperLeg', position: [0.168, 0.505, -0.042] },
      { name: 'leftFoot', parent: 'leftLowerLeg', position: [0.215, 0.1, -0.055] },
      { name: 'leftToes', parent: 'leftFoot', position: [0.236, 0.035, 0.085] },
      { name: 'leftToes_end', parent: 'leftToes', position: [0.24, 0.03, 0.155] },
      { name: 'rightShoulder', parent: 'chest', position: [-0.04, 1.44, -0.045] },
      { name: 'rightUpperArm', parent: 'rightShoulder', position: [-0.2, 1.435, -0.052] },
      { name: 'rightLowerArm', parent: 'rightUpperArm', position: [-0.455, 1.416, -0.051] },
      { name: 'rightHand', parent: 'rightLowerArm', position: [-0.69, 1.418, -0.012] },
      { name: 'rightMiddleProximal', parent: 'rightHand', position: [-0.799, 1.408, 0.016] },
      { name: 'rightMiddleIntermediate', parent: 'rightMiddleProximal', position: [-0.842, 1.404, 0.027] },
      { name: 'rightMiddleDistal', parent: 'rightMiddleIntermediate', position: [-0.868, 1.402, 0.034] },
      { name: 'rightMiddleDistal_end', parent: 'rightMiddleDistal', position: [-0.889, 1.4, 0.039] },
      { name: 'rightIndexProximal', parent: 'rightHand', position: [-0.788, 1.391, 0.027] },
      { name: 'rightIndexIntermediate', parent: 'rightIndexProximal', position: [-0.826, 1.38, 0.042] },
      { name: 'rightIndexDistal', parent: 'rightIndexIntermediate', position: [-0.85, 1.373, 0.052] },
      { name: 'rightIndexDistal_end', parent: 'rightIndexDistal', position: [-0.869, 1.368, 0.059] },
      { name: 'rightRingProximal', parent: 'rightHand', position: [-0.798, 1.427, 0.004] },
      { name: 'rightRingIntermediate', parent: 'rightRingProximal', position: [-0.839, 1.431, 0.01] },
      { name: 'rightRingDistal', parent: 'rightRingIntermediate', position: [-0.866, 1.433, 0.014] },
      { name: 'rightRingDistal_end', parent: 'rightRingDistal', position: [-0.886, 1.435, 0.017] },
      { name: 'rightLittleProximal', parent: 'rightHand', position: [-0.776, 1.442, -0.008] },
      { name: 'rightLittleIntermediate', parent: 'rightLittleProximal', position: [-0.814, 1.452, -0.007] },
      { name: 'rightLittleDistal', parent: 'rightLittleIntermediate', position: [-0.838, 1.459, -0.006] },
      { name: 'rightLittleDistal_end', parent: 'rightLittleDistal', position: [-0.856, 1.464, -0.005] },
      { name: 'rightThumbMetacarpal', parent: 'rightHand', position: [-0.725, 1.39, 0.03] },
      { name: 'rightThumbProximal', parent: 'rightThumbMetacarpal', position: [-0.75, 1.366, 0.054] },
      { name: 'rightThumbDistal', parent: 'rightThumbProximal', position: [-0.769, 1.347, 0.072] },
      { name: 'rightThumbDistal_end', parent: 'rightThumbDistal', position: [-0.784, 1.332, 0.087] },
      { name: 'rightUpperLeg', parent: 'hips', position: [-0.1, 0.885, 0] },
      { name: 'rightLowerLeg', parent: 'rightUpperLeg', position: [-0.168, 0.505, -0.042] },
      { name: 'rightFoot', parent: 'rightLowerLeg', position: [-0.215, 0.1, -0.055] },
      { name: 'rightToes', parent: 'rightFoot', position: [-0.236, 0.035, 0.085] },
      { name: 'rightToes_end', parent: 'rightToes', position: [-0.24, 0.03, 0.155] },
    ],
  })
