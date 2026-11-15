import { CachedRigLoader } from '@drawcall/rig'
import { rigging } from '../served'
import type { Landmarks } from '../humanoid'

/**
 * Where the guard's joints are, measured on her model (public/models/guard.glb) by cross-sections of its solid (m):
 * standing on y = 0 with her arms out and palms down, facing +z, her left at +x. She is 1.70 m to the top of her cap,
 * in a short-sleeved uniform shirt, belted trousers and boots, her hair in a bun at the nape; her arms level, her hands
 * turned a little back with the fingers spread and the thumb under the index; both sides measured alike, so the right
 * is the left mirrored.
 */
export const landmarks: Landmarks = {
  hips: [0, 0.87, -0.03],
  spine: [0, 1.0, -0.01],
  chest: [0, 1.17, -0.01],
  neck: [0, 1.43, -0.045],
  head: [0, 1.5, -0.02],
  crown: [0, 1.685, -0.005],
  left: {
    shoulder: [0.035, 1.33, -0.05],
    arm: [0.175, 1.335, -0.06],
    elbow: [0.425, 1.331, -0.071],
    wrist: [0.652, 1.33, -0.04],
    thumb: [0.685, 1.305, -0.005],
    tips: {
      thumb: [0.747, 1.279, 0.05],
      index: [0.828, 1.309, 0.013],
      middle: [0.84, 1.323, -0.012],
      ring: [0.837, 1.331, -0.04],
      little: [0.81, 1.331, -0.067],
    },
    hip: [0.09, 0.85, -0.025],
    knee: [0.133, 0.49, -0.04],
    ankle: [0.175, 0.085, -0.07],
    ball: [0.19, 0.03, 0.04],
    toe: [0.195, 0.025, 0.105],
  },
}

/**
 * The guard rigged to her skeleton, which is `humanoid(landmarks)` of ../humanoid written out: the vitecache plugin
 * rigs her ahead, in Node, for a load it reads as it is written.
 */
export const rig = () =>
  new CachedRigLoader(rigging.manager, rigging.cache).loadAsync({
    url: '/models/guard.glb',
    resolution: 512,
    skeleton: [
      { name: 'hips', position: [0, 0.87, -0.03] },
      { name: 'spine', parent: 'hips', position: [0, 1, -0.01] },
      { name: 'chest', parent: 'spine', position: [0, 1.17, -0.01] },
      { name: 'neck', parent: 'chest', position: [0, 1.43, -0.045] },
      { name: 'head', parent: 'neck', position: [0, 1.5, -0.02] },
      { name: 'head_end', parent: 'head', position: [0, 1.685, -0.005] },
      { name: 'leftShoulder', parent: 'chest', position: [0.035, 1.33, -0.05] },
      { name: 'leftUpperArm', parent: 'leftShoulder', position: [0.175, 1.335, -0.06] },
      { name: 'leftLowerArm', parent: 'leftUpperArm', position: [0.425, 1.331, -0.071] },
      { name: 'leftHand', parent: 'leftLowerArm', position: [0.652, 1.33, -0.04] },
      { name: 'leftMiddleProximal', parent: 'leftHand', position: [0.755, 1.326, -0.025] },
      { name: 'leftMiddleIntermediate', parent: 'leftMiddleProximal', position: [0.795, 1.325, -0.019] },
      { name: 'leftMiddleDistal', parent: 'leftMiddleIntermediate', position: [0.821, 1.324, -0.015] },
      { name: 'leftMiddleDistal_end', parent: 'leftMiddleDistal', position: [0.84, 1.323, -0.012] },
      { name: 'leftIndexProximal', parent: 'leftHand', position: [0.749, 1.318, -0.011] },
      { name: 'leftIndexIntermediate', parent: 'leftIndexProximal', position: [0.786, 1.314, 0] },
      { name: 'leftIndexDistal', parent: 'leftIndexIntermediate', position: [0.81, 1.311, 0.008] },
      { name: 'leftIndexDistal_end', parent: 'leftIndexDistal', position: [0.828, 1.309, 0.013] },
      { name: 'leftRingProximal', parent: 'leftHand', position: [0.754, 1.331, -0.04] },
      { name: 'leftRingIntermediate', parent: 'leftRingProximal', position: [0.793, 1.331, -0.04] },
      { name: 'leftRingDistal', parent: 'leftRingIntermediate', position: [0.818, 1.331, -0.04] },
      { name: 'leftRingDistal_end', parent: 'leftRingDistal', position: [0.837, 1.331, -0.04] },
      { name: 'leftLittleProximal', parent: 'leftHand', position: [0.734, 1.331, -0.054] },
      { name: 'leftLittleIntermediate', parent: 'leftLittleProximal', position: [0.77, 1.331, -0.06] },
      { name: 'leftLittleDistal', parent: 'leftLittleIntermediate', position: [0.793, 1.331, -0.064] },
      { name: 'leftLittleDistal_end', parent: 'leftLittleDistal', position: [0.81, 1.331, -0.067] },
      { name: 'leftThumbMetacarpal', parent: 'leftHand', position: [0.685, 1.305, -0.005] },
      { name: 'leftThumbProximal', parent: 'leftThumbMetacarpal', position: [0.711, 1.294, 0.018] },
      { name: 'leftThumbDistal', parent: 'leftThumbProximal', position: [0.731, 1.286, 0.036] },
      { name: 'leftThumbDistal_end', parent: 'leftThumbDistal', position: [0.747, 1.279, 0.05] },
      { name: 'leftUpperLeg', parent: 'hips', position: [0.09, 0.85, -0.025] },
      { name: 'leftLowerLeg', parent: 'leftUpperLeg', position: [0.133, 0.49, -0.04] },
      { name: 'leftFoot', parent: 'leftLowerLeg', position: [0.175, 0.085, -0.07] },
      { name: 'leftToes', parent: 'leftFoot', position: [0.19, 0.03, 0.04] },
      { name: 'leftToes_end', parent: 'leftToes', position: [0.195, 0.025, 0.105] },
      { name: 'rightShoulder', parent: 'chest', position: [-0.035, 1.33, -0.05] },
      { name: 'rightUpperArm', parent: 'rightShoulder', position: [-0.175, 1.335, -0.06] },
      { name: 'rightLowerArm', parent: 'rightUpperArm', position: [-0.425, 1.331, -0.071] },
      { name: 'rightHand', parent: 'rightLowerArm', position: [-0.652, 1.33, -0.04] },
      { name: 'rightMiddleProximal', parent: 'rightHand', position: [-0.755, 1.326, -0.025] },
      { name: 'rightMiddleIntermediate', parent: 'rightMiddleProximal', position: [-0.795, 1.325, -0.019] },
      { name: 'rightMiddleDistal', parent: 'rightMiddleIntermediate', position: [-0.821, 1.324, -0.015] },
      { name: 'rightMiddleDistal_end', parent: 'rightMiddleDistal', position: [-0.84, 1.323, -0.012] },
      { name: 'rightIndexProximal', parent: 'rightHand', position: [-0.749, 1.318, -0.011] },
      { name: 'rightIndexIntermediate', parent: 'rightIndexProximal', position: [-0.786, 1.314, 0] },
      { name: 'rightIndexDistal', parent: 'rightIndexIntermediate', position: [-0.81, 1.311, 0.008] },
      { name: 'rightIndexDistal_end', parent: 'rightIndexDistal', position: [-0.828, 1.309, 0.013] },
      { name: 'rightRingProximal', parent: 'rightHand', position: [-0.754, 1.331, -0.04] },
      { name: 'rightRingIntermediate', parent: 'rightRingProximal', position: [-0.793, 1.331, -0.04] },
      { name: 'rightRingDistal', parent: 'rightRingIntermediate', position: [-0.818, 1.331, -0.04] },
      { name: 'rightRingDistal_end', parent: 'rightRingDistal', position: [-0.837, 1.331, -0.04] },
      { name: 'rightLittleProximal', parent: 'rightHand', position: [-0.734, 1.331, -0.054] },
      { name: 'rightLittleIntermediate', parent: 'rightLittleProximal', position: [-0.77, 1.331, -0.06] },
      { name: 'rightLittleDistal', parent: 'rightLittleIntermediate', position: [-0.793, 1.331, -0.064] },
      { name: 'rightLittleDistal_end', parent: 'rightLittleDistal', position: [-0.81, 1.331, -0.067] },
      { name: 'rightThumbMetacarpal', parent: 'rightHand', position: [-0.685, 1.305, -0.005] },
      { name: 'rightThumbProximal', parent: 'rightThumbMetacarpal', position: [-0.711, 1.294, 0.018] },
      { name: 'rightThumbDistal', parent: 'rightThumbProximal', position: [-0.731, 1.286, 0.036] },
      { name: 'rightThumbDistal_end', parent: 'rightThumbDistal', position: [-0.747, 1.279, 0.05] },
      { name: 'rightUpperLeg', parent: 'hips', position: [-0.09, 0.85, -0.025] },
      { name: 'rightLowerLeg', parent: 'rightUpperLeg', position: [-0.133, 0.49, -0.04] },
      { name: 'rightFoot', parent: 'rightLowerLeg', position: [-0.175, 0.085, -0.07] },
      { name: 'rightToes', parent: 'rightFoot', position: [-0.19, 0.03, 0.04] },
      { name: 'rightToes_end', parent: 'rightToes', position: [-0.195, 0.025, 0.105] },
    ],
  })
