import { CachedRigLoader } from '@drawcall/rig'
import { rigging } from '../served'
import type { Landmarks } from '../humanoid'

/**
 * Where the thrower's joints are, measured on his model (public/models/thrower.glb) by cross-sections of its solid (m):
 * standing on y = 0 with his arms out and palms down, facing +z, his left at +x. He is 1.88 m to his crown, long in the
 * leg, his arms nearly level, his hands turned well ahead with the fingers spread and the thumb ahead and below the
 * index; both sides measured alike, so the right is the left mirrored.
 */
export const landmarks: Landmarks = {
  hips: [0, 0.985, -0.01],
  spine: [0, 1.1, 0.0],
  chest: [0, 1.3, 0.0],
  neck: [0, 1.61, -0.045],
  head: [0, 1.68, 0.01],
  crown: [0, 1.875, 0.015],
  left: {
    shoulder: [0.04, 1.52, -0.05],
    arm: [0.215, 1.51, -0.055],
    elbow: [0.475, 1.483, -0.055],
    wrist: [0.725, 1.478, 0.026],
    thumb: [0.745, 1.46, 0.062],
    tips: {
      thumb: [0.835, 1.412, 0.15],
      index: [0.913, 1.448, 0.141],
      middle: [0.937, 1.481, 0.104],
      ring: [0.932, 1.453, 0.063],
      little: [0.912, 1.449, 0.015],
    },
    hip: [0.1, 0.975, -0.005],
    knee: [0.163, 0.56, -0.035],
    ankle: [0.222, 0.1, -0.06],
    ball: [0.245, 0.03, 0.075],
    toe: [0.25, 0.03, 0.165],
  },
}

/**
 * The thrower rigged to his skeleton, which is `humanoid(landmarks)` of ../humanoid written out: the vitecache plugin
 * rigs him ahead, in Node, for a load it reads as it is written.
 */
export const rig = () =>
  new CachedRigLoader(rigging.manager, rigging.cache).loadAsync({
    url: '/models/thrower.glb',
    resolution: 512,
    skeleton: [
      { name: 'hips', position: [0, 0.985, -0.01] },
      { name: 'spine', parent: 'hips', position: [0, 1.1, 0] },
      { name: 'chest', parent: 'spine', position: [0, 1.3, 0] },
      { name: 'neck', parent: 'chest', position: [0, 1.61, -0.045] },
      { name: 'head', parent: 'neck', position: [0, 1.68, 0.01] },
      { name: 'head_end', parent: 'head', position: [0, 1.875, 0.015] },
      { name: 'leftShoulder', parent: 'chest', position: [0.04, 1.52, -0.05] },
      { name: 'leftUpperArm', parent: 'leftShoulder', position: [0.215, 1.51, -0.055] },
      { name: 'leftLowerArm', parent: 'leftUpperArm', position: [0.475, 1.483, -0.055] },
      { name: 'leftHand', parent: 'leftLowerArm', position: [0.725, 1.478, 0.026] },
      { name: 'leftMiddleProximal', parent: 'leftHand', position: [0.842, 1.48, 0.069] },
      { name: 'leftMiddleIntermediate', parent: 'leftMiddleProximal', position: [0.886, 1.48, 0.085] },
      { name: 'leftMiddleDistal', parent: 'leftMiddleIntermediate', position: [0.915, 1.481, 0.096] },
      { name: 'leftMiddleDistal_end', parent: 'leftMiddleDistal', position: [0.937, 1.481, 0.104] },
      { name: 'leftIndexProximal', parent: 'leftHand', position: [0.828, 1.462, 0.089] },
      { name: 'leftIndexIntermediate', parent: 'leftIndexProximal', position: [0.868, 1.455, 0.114] },
      { name: 'leftIndexDistal', parent: 'leftIndexIntermediate', position: [0.894, 1.451, 0.129] },
      { name: 'leftIndexDistal_end', parent: 'leftIndexDistal', position: [0.913, 1.448, 0.141] },
      { name: 'leftRingProximal', parent: 'leftHand', position: [0.839, 1.464, 0.046] },
      { name: 'leftRingIntermediate', parent: 'leftRingProximal', position: [0.883, 1.459, 0.054] },
      { name: 'leftRingDistal', parent: 'leftRingIntermediate', position: [0.911, 1.456, 0.059] },
      { name: 'leftRingDistal_end', parent: 'leftRingDistal', position: [0.932, 1.453, 0.063] },
      { name: 'leftLittleProximal', parent: 'leftHand', position: [0.822, 1.463, 0.02] },
      { name: 'leftLittleIntermediate', parent: 'leftLittleProximal', position: [0.864, 1.456, 0.018] },
      { name: 'leftLittleDistal', parent: 'leftLittleIntermediate', position: [0.891, 1.452, 0.016] },
      { name: 'leftLittleDistal_end', parent: 'leftLittleDistal', position: [0.912, 1.449, 0.015] },
      { name: 'leftThumbMetacarpal', parent: 'leftHand', position: [0.745, 1.46, 0.062] },
      { name: 'leftThumbProximal', parent: 'leftThumbMetacarpal', position: [0.783, 1.44, 0.099] },
      { name: 'leftThumbDistal', parent: 'leftThumbProximal', position: [0.812, 1.424, 0.127] },
      { name: 'leftThumbDistal_end', parent: 'leftThumbDistal', position: [0.835, 1.412, 0.15] },
      { name: 'leftUpperLeg', parent: 'hips', position: [0.1, 0.975, -0.005] },
      { name: 'leftLowerLeg', parent: 'leftUpperLeg', position: [0.163, 0.56, -0.035] },
      { name: 'leftFoot', parent: 'leftLowerLeg', position: [0.222, 0.1, -0.06] },
      { name: 'leftToes', parent: 'leftFoot', position: [0.245, 0.03, 0.075] },
      { name: 'leftToes_end', parent: 'leftToes', position: [0.25, 0.03, 0.165] },
      { name: 'rightShoulder', parent: 'chest', position: [-0.04, 1.52, -0.05] },
      { name: 'rightUpperArm', parent: 'rightShoulder', position: [-0.215, 1.51, -0.055] },
      { name: 'rightLowerArm', parent: 'rightUpperArm', position: [-0.475, 1.483, -0.055] },
      { name: 'rightHand', parent: 'rightLowerArm', position: [-0.725, 1.478, 0.026] },
      { name: 'rightMiddleProximal', parent: 'rightHand', position: [-0.842, 1.48, 0.069] },
      { name: 'rightMiddleIntermediate', parent: 'rightMiddleProximal', position: [-0.886, 1.48, 0.085] },
      { name: 'rightMiddleDistal', parent: 'rightMiddleIntermediate', position: [-0.915, 1.481, 0.096] },
      { name: 'rightMiddleDistal_end', parent: 'rightMiddleDistal', position: [-0.937, 1.481, 0.104] },
      { name: 'rightIndexProximal', parent: 'rightHand', position: [-0.828, 1.462, 0.089] },
      { name: 'rightIndexIntermediate', parent: 'rightIndexProximal', position: [-0.868, 1.455, 0.114] },
      { name: 'rightIndexDistal', parent: 'rightIndexIntermediate', position: [-0.894, 1.451, 0.129] },
      { name: 'rightIndexDistal_end', parent: 'rightIndexDistal', position: [-0.913, 1.448, 0.141] },
      { name: 'rightRingProximal', parent: 'rightHand', position: [-0.839, 1.464, 0.046] },
      { name: 'rightRingIntermediate', parent: 'rightRingProximal', position: [-0.883, 1.459, 0.054] },
      { name: 'rightRingDistal', parent: 'rightRingIntermediate', position: [-0.911, 1.456, 0.059] },
      { name: 'rightRingDistal_end', parent: 'rightRingDistal', position: [-0.932, 1.453, 0.063] },
      { name: 'rightLittleProximal', parent: 'rightHand', position: [-0.822, 1.463, 0.02] },
      { name: 'rightLittleIntermediate', parent: 'rightLittleProximal', position: [-0.864, 1.456, 0.018] },
      { name: 'rightLittleDistal', parent: 'rightLittleIntermediate', position: [-0.891, 1.452, 0.016] },
      { name: 'rightLittleDistal_end', parent: 'rightLittleDistal', position: [-0.912, 1.449, 0.015] },
      { name: 'rightThumbMetacarpal', parent: 'rightHand', position: [-0.745, 1.46, 0.062] },
      { name: 'rightThumbProximal', parent: 'rightThumbMetacarpal', position: [-0.783, 1.44, 0.099] },
      { name: 'rightThumbDistal', parent: 'rightThumbProximal', position: [-0.812, 1.424, 0.127] },
      { name: 'rightThumbDistal_end', parent: 'rightThumbDistal', position: [-0.835, 1.412, 0.15] },
      { name: 'rightUpperLeg', parent: 'hips', position: [-0.1, 0.975, -0.005] },
      { name: 'rightLowerLeg', parent: 'rightUpperLeg', position: [-0.163, 0.56, -0.035] },
      { name: 'rightFoot', parent: 'rightLowerLeg', position: [-0.222, 0.1, -0.06] },
      { name: 'rightToes', parent: 'rightFoot', position: [-0.245, 0.03, 0.075] },
      { name: 'rightToes_end', parent: 'rightToes', position: [-0.25, 0.03, 0.165] },
    ],
  })
