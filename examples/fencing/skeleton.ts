import { CachedRigLoader } from '@drawcall/rig'
import { rigging } from '../served'
import type { Landmarks } from '../humanoid'

/**
 * Where the fencer's joints are, measured on his model (public/models/fencer.glb) by cross-sections of its solid (m):
 * standing on y = 0 with his arms out, facing +z, his left at +x. He is 1.78 m to his crown, his arms sloping a little
 * down to his gloved hands at about 1.38 m, his hands rolled forward so that his fingers spread one above the other,
 * the index lowest and the little finger highest and furthest back, the thumb pointing down and ahead; both sides
 * measured alike, so the right is the left mirrored.
 */
export const landmarks: Landmarks = {
  hips: [0, 0.92, -0.01],
  spine: [0, 0.99, -0.01],
  chest: [0, 1.175, 0.0],
  neck: [0, 1.49, -0.045],
  head: [0, 1.575, -0.01],
  crown: [0, 1.775, 0.005],
  left: {
    shoulder: [0.04, 1.41, -0.045],
    arm: [0.19, 1.405, -0.048],
    elbow: [0.44, 1.391, -0.055],
    wrist: [0.7, 1.38, -0.055],
    thumb: [0.735, 1.35, -0.03],
    tips: {
      thumb: [0.801, 1.305, 0.012],
      index: [0.861, 1.335, -0.024],
      middle: [0.881, 1.359, -0.051],
      ring: [0.879, 1.39, -0.072],
      little: [0.861, 1.412, -0.097],
    },
    hip: [0.1, 0.9, -0.01],
    knee: [0.17, 0.465, -0.058],
    ankle: [0.205, 0.095, -0.055],
    ball: [0.228, 0.035, 0.075],
    toe: [0.232, 0.03, 0.14],
  },
}

/**
 * The fencer rigged to his skeleton, which is `humanoid(landmarks)` of ../humanoid written out: the vitecache plugin
 * rigs him ahead, in Node, for a load it reads as it is written.
 */
export const rig = () =>
  new CachedRigLoader(rigging.manager, rigging.cache).loadAsync({
    url: '/models/fencer.glb',
    resolution: 512,
    skeleton: [
      { name: 'hips', position: [0, 0.92, -0.01] },
      { name: 'spine', parent: 'hips', position: [0, 0.99, -0.01] },
      { name: 'chest', parent: 'spine', position: [0, 1.175, 0] },
      { name: 'neck', parent: 'chest', position: [0, 1.49, -0.045] },
      { name: 'head', parent: 'neck', position: [0, 1.575, -0.01] },
      { name: 'head_end', parent: 'head', position: [0, 1.775, 0.005] },
      { name: 'leftShoulder', parent: 'chest', position: [0.04, 1.41, -0.045] },
      { name: 'leftUpperArm', parent: 'leftShoulder', position: [0.19, 1.405, -0.048] },
      { name: 'leftLowerArm', parent: 'leftUpperArm', position: [0.44, 1.391, -0.055] },
      { name: 'leftHand', parent: 'leftLowerArm', position: [0.7, 1.38, -0.055] },
      { name: 'leftMiddleProximal', parent: 'leftHand', position: [0.8, 1.368, -0.053] },
      { name: 'leftMiddleIntermediate', parent: 'leftMiddleProximal', position: [0.838, 1.364, -0.052] },
      { name: 'leftMiddleDistal', parent: 'leftMiddleIntermediate', position: [0.862, 1.361, -0.051] },
      { name: 'leftMiddleDistal_end', parent: 'leftMiddleDistal', position: [0.881, 1.359, -0.051] },
      { name: 'leftIndexProximal', parent: 'leftHand', position: [0.789, 1.355, -0.038] },
      { name: 'leftIndexIntermediate', parent: 'leftIndexProximal', position: [0.823, 1.346, -0.031] },
      { name: 'leftIndexDistal', parent: 'leftIndexIntermediate', position: [0.844, 1.34, -0.027] },
      { name: 'leftIndexDistal_end', parent: 'leftIndexDistal', position: [0.861, 1.335, -0.024] },
      { name: 'leftRingProximal', parent: 'leftHand', position: [0.798, 1.386, -0.064] },
      { name: 'leftRingIntermediate', parent: 'leftRingProximal', position: [0.836, 1.388, -0.068] },
      { name: 'leftRingDistal', parent: 'leftRingIntermediate', position: [0.86, 1.389, -0.07] },
      { name: 'leftRingDistal_end', parent: 'leftRingDistal', position: [0.879, 1.39, -0.072] },
      { name: 'leftLittleProximal', parent: 'leftHand', position: [0.784, 1.397, -0.077] },
      { name: 'leftLittleIntermediate', parent: 'leftLittleProximal', position: [0.82, 1.404, -0.086] },
      { name: 'leftLittleDistal', parent: 'leftLittleIntermediate', position: [0.843, 1.408, -0.092] },
      { name: 'leftLittleDistal_end', parent: 'leftLittleDistal', position: [0.861, 1.412, -0.097] },
      { name: 'leftThumbMetacarpal', parent: 'leftHand', position: [0.735, 1.35, -0.03] },
      { name: 'leftThumbProximal', parent: 'leftThumbMetacarpal', position: [0.763, 1.331, -0.012] },
      { name: 'leftThumbDistal', parent: 'leftThumbProximal', position: [0.784, 1.317, 0.001] },
      { name: 'leftThumbDistal_end', parent: 'leftThumbDistal', position: [0.801, 1.305, 0.012] },
      { name: 'leftUpperLeg', parent: 'hips', position: [0.1, 0.9, -0.01] },
      { name: 'leftLowerLeg', parent: 'leftUpperLeg', position: [0.17, 0.465, -0.058] },
      { name: 'leftFoot', parent: 'leftLowerLeg', position: [0.205, 0.095, -0.055] },
      { name: 'leftToes', parent: 'leftFoot', position: [0.228, 0.035, 0.075] },
      { name: 'leftToes_end', parent: 'leftToes', position: [0.232, 0.03, 0.14] },
      { name: 'rightShoulder', parent: 'chest', position: [-0.04, 1.41, -0.045] },
      { name: 'rightUpperArm', parent: 'rightShoulder', position: [-0.19, 1.405, -0.048] },
      { name: 'rightLowerArm', parent: 'rightUpperArm', position: [-0.44, 1.391, -0.055] },
      { name: 'rightHand', parent: 'rightLowerArm', position: [-0.7, 1.38, -0.055] },
      { name: 'rightMiddleProximal', parent: 'rightHand', position: [-0.8, 1.368, -0.053] },
      { name: 'rightMiddleIntermediate', parent: 'rightMiddleProximal', position: [-0.838, 1.364, -0.052] },
      { name: 'rightMiddleDistal', parent: 'rightMiddleIntermediate', position: [-0.862, 1.361, -0.051] },
      { name: 'rightMiddleDistal_end', parent: 'rightMiddleDistal', position: [-0.881, 1.359, -0.051] },
      { name: 'rightIndexProximal', parent: 'rightHand', position: [-0.789, 1.355, -0.038] },
      { name: 'rightIndexIntermediate', parent: 'rightIndexProximal', position: [-0.823, 1.346, -0.031] },
      { name: 'rightIndexDistal', parent: 'rightIndexIntermediate', position: [-0.844, 1.34, -0.027] },
      { name: 'rightIndexDistal_end', parent: 'rightIndexDistal', position: [-0.861, 1.335, -0.024] },
      { name: 'rightRingProximal', parent: 'rightHand', position: [-0.798, 1.386, -0.064] },
      { name: 'rightRingIntermediate', parent: 'rightRingProximal', position: [-0.836, 1.388, -0.068] },
      { name: 'rightRingDistal', parent: 'rightRingIntermediate', position: [-0.86, 1.389, -0.07] },
      { name: 'rightRingDistal_end', parent: 'rightRingDistal', position: [-0.879, 1.39, -0.072] },
      { name: 'rightLittleProximal', parent: 'rightHand', position: [-0.784, 1.397, -0.077] },
      { name: 'rightLittleIntermediate', parent: 'rightLittleProximal', position: [-0.82, 1.404, -0.086] },
      { name: 'rightLittleDistal', parent: 'rightLittleIntermediate', position: [-0.843, 1.408, -0.092] },
      { name: 'rightLittleDistal_end', parent: 'rightLittleDistal', position: [-0.861, 1.412, -0.097] },
      { name: 'rightThumbMetacarpal', parent: 'rightHand', position: [-0.735, 1.35, -0.03] },
      { name: 'rightThumbProximal', parent: 'rightThumbMetacarpal', position: [-0.763, 1.331, -0.012] },
      { name: 'rightThumbDistal', parent: 'rightThumbProximal', position: [-0.784, 1.317, 0.001] },
      { name: 'rightThumbDistal_end', parent: 'rightThumbDistal', position: [-0.801, 1.305, 0.012] },
      { name: 'rightUpperLeg', parent: 'hips', position: [-0.1, 0.9, -0.01] },
      { name: 'rightLowerLeg', parent: 'rightUpperLeg', position: [-0.17, 0.465, -0.058] },
      { name: 'rightFoot', parent: 'rightLowerLeg', position: [-0.205, 0.095, -0.055] },
      { name: 'rightToes', parent: 'rightFoot', position: [-0.228, 0.035, 0.075] },
      { name: 'rightToes_end', parent: 'rightToes', position: [-0.232, 0.03, 0.14] },
    ],
  })
