import { CachedRigLoader } from '@drawcall/rig'
import type { Landmarks } from '../humanoid'

/**
 * Where the player's joints are, measured on his model (public/models/player.glb) by cross-sections of its solid (m):
 * standing on y = 0 with his arms out and palms down, facing +z, his left at +x. He is 1.85 m to his crown, his arms
 * a little below level with the forearms turned ahead, so his hands reach forward of his shoulders, the fingers
 * spread and the thumb ahead under the index, a wristband on his right wrist; both sides measured alike, so the
 * right is the left mirrored.
 */
export const landmarks: Landmarks = {
  hips: [0, 0.91, -0.01],
  spine: [0, 1.02, -0.01],
  chest: [0, 1.22, -0.025],
  neck: [0, 1.56, -0.05],
  head: [0, 1.64, -0.005],
  crown: [0, 1.845, 0.005],
  left: {
    shoulder: [0.04, 1.495, -0.055],
    arm: [0.19, 1.46, -0.062],
    elbow: [0.46, 1.445, -0.059],
    wrist: [0.7, 1.427, 0.041],
    thumb: [0.735, 1.4, 0.09],
    tips: {
      thumb: [0.789, 1.368, 0.173],
      index: [0.871, 1.388, 0.164],
      middle: [0.896, 1.413, 0.134],
      ring: [0.899, 1.416, 0.096],
      little: [0.88, 1.414, 0.058],
    },
    hip: [0.095, 0.895, -0.01],
    knee: [0.16, 0.52, -0.05],
    ankle: [0.205, 0.095, -0.065],
    ball: [0.22, 0.035, 0.065],
    toe: [0.225, 0.03, 0.165],
  },
}

/**
 * The player rigged to his skeleton, which is `humanoid(landmarks)` of ../humanoid written out: the vitecache plugin
 * rigs him ahead, in Node, for a load it reads as it is written.
 */
export const rig = () =>
  new CachedRigLoader().loadAsync({
    url: '/models/player.glb',
    resolution: 512,
    skeleton: [
      { name: 'hips', position: [0, 0.91, -0.01] },
      { name: 'spine', parent: 'hips', position: [0, 1.02, -0.01] },
      { name: 'chest', parent: 'spine', position: [0, 1.22, -0.025] },
      { name: 'neck', parent: 'chest', position: [0, 1.56, -0.05] },
      { name: 'head', parent: 'neck', position: [0, 1.64, -0.005] },
      { name: 'head_end', parent: 'head', position: [0, 1.845, 0.005] },
      { name: 'leftShoulder', parent: 'chest', position: [0.04, 1.495, -0.055] },
      { name: 'leftUpperArm', parent: 'leftShoulder', position: [0.19, 1.46, -0.062] },
      { name: 'leftLowerArm', parent: 'leftUpperArm', position: [0.46, 1.445, -0.059] },
      { name: 'leftHand', parent: 'leftLowerArm', position: [0.7, 1.427, 0.041] },
      { name: 'leftMiddleProximal', parent: 'leftHand', position: [0.808, 1.419, 0.092] },
      { name: 'leftMiddleIntermediate', parent: 'leftMiddleProximal', position: [0.849, 1.416, 0.112] },
      { name: 'leftMiddleDistal', parent: 'leftMiddleIntermediate', position: [0.876, 1.414, 0.124] },
      { name: 'leftMiddleDistal_end', parent: 'leftMiddleDistal', position: [0.896, 1.413, 0.134] },
      { name: 'leftIndexProximal', parent: 'leftHand', position: [0.794, 1.406, 0.109] },
      { name: 'leftIndexIntermediate', parent: 'leftIndexProximal', position: [0.83, 1.397, 0.135] },
      { name: 'leftIndexDistal', parent: 'leftIndexIntermediate', position: [0.853, 1.392, 0.151] },
      { name: 'leftIndexDistal_end', parent: 'leftIndexDistal', position: [0.871, 1.388, 0.164] },
      { name: 'leftRingProximal', parent: 'leftHand', position: [0.809, 1.421, 0.071] },
      { name: 'leftRingIntermediate', parent: 'leftRingProximal', position: [0.852, 1.419, 0.083] },
      { name: 'leftRingDistal', parent: 'leftRingIntermediate', position: [0.878, 1.417, 0.09] },
      { name: 'leftRingDistal_end', parent: 'leftRingDistal', position: [0.899, 1.416, 0.096] },
      { name: 'leftLittleProximal', parent: 'leftHand', position: [0.794, 1.42, 0.05] },
      { name: 'leftLittleIntermediate', parent: 'leftLittleProximal', position: [0.834, 1.417, 0.054] },
      { name: 'leftLittleDistal', parent: 'leftLittleIntermediate', position: [0.86, 1.415, 0.056] },
      { name: 'leftLittleDistal_end', parent: 'leftLittleDistal', position: [0.88, 1.414, 0.058] },
      { name: 'leftThumbMetacarpal', parent: 'leftHand', position: [0.735, 1.4, 0.09] },
      { name: 'leftThumbProximal', parent: 'leftThumbMetacarpal', position: [0.758, 1.387, 0.125] },
      { name: 'leftThumbDistal', parent: 'leftThumbProximal', position: [0.775, 1.376, 0.151] },
      { name: 'leftThumbDistal_end', parent: 'leftThumbDistal', position: [0.789, 1.368, 0.173] },
      { name: 'leftUpperLeg', parent: 'hips', position: [0.095, 0.895, -0.01] },
      { name: 'leftLowerLeg', parent: 'leftUpperLeg', position: [0.16, 0.52, -0.05] },
      { name: 'leftFoot', parent: 'leftLowerLeg', position: [0.205, 0.095, -0.065] },
      { name: 'leftToes', parent: 'leftFoot', position: [0.22, 0.035, 0.065] },
      { name: 'leftToes_end', parent: 'leftToes', position: [0.225, 0.03, 0.165] },
      { name: 'rightShoulder', parent: 'chest', position: [-0.04, 1.495, -0.055] },
      { name: 'rightUpperArm', parent: 'rightShoulder', position: [-0.19, 1.46, -0.062] },
      { name: 'rightLowerArm', parent: 'rightUpperArm', position: [-0.46, 1.445, -0.059] },
      { name: 'rightHand', parent: 'rightLowerArm', position: [-0.7, 1.427, 0.041] },
      { name: 'rightMiddleProximal', parent: 'rightHand', position: [-0.808, 1.419, 0.092] },
      { name: 'rightMiddleIntermediate', parent: 'rightMiddleProximal', position: [-0.849, 1.416, 0.112] },
      { name: 'rightMiddleDistal', parent: 'rightMiddleIntermediate', position: [-0.876, 1.414, 0.124] },
      { name: 'rightMiddleDistal_end', parent: 'rightMiddleDistal', position: [-0.896, 1.413, 0.134] },
      { name: 'rightIndexProximal', parent: 'rightHand', position: [-0.794, 1.406, 0.109] },
      { name: 'rightIndexIntermediate', parent: 'rightIndexProximal', position: [-0.83, 1.397, 0.135] },
      { name: 'rightIndexDistal', parent: 'rightIndexIntermediate', position: [-0.853, 1.392, 0.151] },
      { name: 'rightIndexDistal_end', parent: 'rightIndexDistal', position: [-0.871, 1.388, 0.164] },
      { name: 'rightRingProximal', parent: 'rightHand', position: [-0.809, 1.421, 0.071] },
      { name: 'rightRingIntermediate', parent: 'rightRingProximal', position: [-0.852, 1.419, 0.083] },
      { name: 'rightRingDistal', parent: 'rightRingIntermediate', position: [-0.878, 1.417, 0.09] },
      { name: 'rightRingDistal_end', parent: 'rightRingDistal', position: [-0.899, 1.416, 0.096] },
      { name: 'rightLittleProximal', parent: 'rightHand', position: [-0.794, 1.42, 0.05] },
      { name: 'rightLittleIntermediate', parent: 'rightLittleProximal', position: [-0.834, 1.417, 0.054] },
      { name: 'rightLittleDistal', parent: 'rightLittleIntermediate', position: [-0.86, 1.415, 0.056] },
      { name: 'rightLittleDistal_end', parent: 'rightLittleDistal', position: [-0.88, 1.414, 0.058] },
      { name: 'rightThumbMetacarpal', parent: 'rightHand', position: [-0.735, 1.4, 0.09] },
      { name: 'rightThumbProximal', parent: 'rightThumbMetacarpal', position: [-0.758, 1.387, 0.125] },
      { name: 'rightThumbDistal', parent: 'rightThumbProximal', position: [-0.775, 1.376, 0.151] },
      { name: 'rightThumbDistal_end', parent: 'rightThumbDistal', position: [-0.789, 1.368, 0.173] },
      { name: 'rightUpperLeg', parent: 'hips', position: [-0.095, 0.895, -0.01] },
      { name: 'rightLowerLeg', parent: 'rightUpperLeg', position: [-0.16, 0.52, -0.05] },
      { name: 'rightFoot', parent: 'rightLowerLeg', position: [-0.205, 0.095, -0.065] },
      { name: 'rightToes', parent: 'rightFoot', position: [-0.22, 0.035, 0.065] },
      { name: 'rightToes_end', parent: 'rightToes', position: [-0.225, 0.03, 0.165] },
    ],
  })
